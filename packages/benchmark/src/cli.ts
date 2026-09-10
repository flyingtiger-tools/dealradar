import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createOpenAiProvider, createMemoryCache, type AIProvider } from "@dealradar/ai";
import { createSimulatedProvider } from "./provider/simulated";
import { createTimingCache } from "./instrumentation/timing-cache";
import { createTimingProvider } from "./instrumentation/timing-provider";
import { loadDataset } from "./dataset/load-dataset";
import { runListing, buildComparablePool } from "./pipeline/run-listing";
import { aggregate, combineAggregates } from "./metrics/aggregate";
import { renderReport } from "./report/render-html";
import { loadBaseline, saveBaseline, compareToBaseline, type RegressionResult } from "./regression/baseline";
import { runDatasetOnline } from "./online/supabase-runner";
import { cleanupBenchmarkRun } from "./online/cleanup";
import { runTcgCli } from "./tcg/cli-tcg";
import { validateTcgDataset, type TcgDatasetValidationReport } from "./tcg/validate-tcg-dataset";
import type { TcgBenchmarkReport, TcgMatrixMetrics } from "./tcg/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALL_CATEGORIES = ["lego", "pokemon_tcg", "apple", "gaming", "photo"];
const DATASETS_DIR = path.resolve(__dirname, "../datasets");
const BASELINE_DIR = path.resolve(__dirname, "../baseline");
const REPORTS_DIR = path.resolve(__dirname, "../reports");
const IMAGE_DOMAIN_ALLOWLIST = ["ebayimg.com"];

interface CliArgs {
  datasets: string[];
  providerName: "simulated" | "openai";
  online: boolean;
  cleanupOnly: boolean;
  saveBaseline: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const datasetArg = argv.find((a) => a.startsWith("--dataset="))?.split("=")[1];
  const providerArg = argv.find((a) => a.startsWith("--provider="))?.split("=")[1];
  const datasets = !datasetArg || datasetArg === "all" ? ALL_CATEGORIES : datasetArg.split(",");
  return {
    datasets,
    providerName: providerArg === "openai" ? "openai" : "simulated",
    online: argv.includes("--online"),
    cleanupOnly: argv.includes("--cleanup-only"),
    saveBaseline: argv.includes("--save-baseline"),
  };
}

function buildProvider(name: "simulated" | "openai"): { provider: AIProvider; label: string } {
  if (name === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn("OPENAI_API_KEY absent — repli sur le provider simulé (jamais de clé fabriquée).");
      return { provider: createSimulatedProvider(), label: "simulated (repli, OPENAI_API_KEY absent)" };
    }
    const model = process.env.AI_MODEL ?? "gpt-4o-mini";
    return { provider: createOpenAiProvider({ apiKey, model }), label: `openai (${model})` };
  }
  return { provider: createSimulatedProvider(), label: "simulated (aucune clé réelle disponible)" };
}

async function runOffline(datasetNames: string[], providerName: "simulated" | "openai", saveBaselineFlag: boolean) {
  const { provider: rawProvider, label } = buildProvider(providerName);
  const asOf = new Date().toISOString();

  const allMetrics = [];
  const regressionResults: RegressionResult[] = [];

  for (const name of datasetNames) {
    const dataset = loadDataset(path.join(DATASETS_DIR, `${name}.json`));
    const candidatePool = buildComparablePool(dataset.comparables, dataset.categorySlug, asOf);

    const { cache, timings: cacheTimings } = createTimingCache(createMemoryCache());
    const { provider, timings: providerTimings } = createTimingProvider(rawProvider);

    const results = [];
    for (const item of dataset.items) {
      results.push(
        await runListing(item, {
          categorySlug: dataset.categorySlug,
          asOf,
          provider,
          cache,
          cacheTimings,
          providerTimings,
          imageDomainAllowlist: IMAGE_DOMAIN_ALLOWLIST,
          candidatePool,
        }),
      );
    }

    const metrics = aggregate({ categorySlug: dataset.categorySlug, provenance: dataset.provenance, datasetLabel: `${name}.json`, results });
    allMetrics.push(metrics);

    const baselinePath = path.join(BASELINE_DIR, `${name}.json`);
    if (saveBaselineFlag) {
      saveBaseline(baselinePath, metrics);
      console.log(`Baseline enregistrée : ${baselinePath}`);
    } else {
      regressionResults.push(compareToBaseline(metrics, loadBaseline(baselinePath)));
    }
  }

  const provenances = new Set(allMetrics.map((m) => m.provenance));
  const combined = provenances.size === 1 && allMetrics.length > 1 ? combineAggregates(allMetrics) : undefined;

  const html = renderReport({
    generatedAt: new Date().toISOString(),
    providerLabel: label,
    mode: "offline",
    datasets: allMetrics,
    combined,
    regression: saveBaselineFlag ? undefined : regressionResults,
  });

  const reportDir = path.join(REPORTS_DIR, new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "index.html");
  writeFileSync(reportPath, html, "utf8");
  console.log(`Rapport généré : ${reportPath}`);

  for (const metrics of allMetrics) {
    console.log(
      `${metrics.categorySlug}: ${metrics.usableListings}/${metrics.totalListings} exploitables, ` +
        `précision annotée=${metrics.precisionAnnotee === null ? "n/a" : (metrics.precisionAnnotee * 100).toFixed(1) + "%"}, ` +
        `déterministe seul=${(metrics.rates.deterministicOnly * 100).toFixed(1)}%, ` +
        `IA=${(metrics.rates.aiCalled * 100).toFixed(1)}%, ` +
        `INSUFFICIENT_DATA=${(metrics.rates.insufficientData * 100).toFixed(1)}%`,
    );
  }

  if (!saveBaselineFlag) {
    const failed = regressionResults.filter((r) => !r.passed);
    if (failed.length > 0) {
      console.error(`RÉGRESSION DE QUALITÉ détectée sur : ${failed.map((f) => f.categorySlug).join(", ")}`);
      for (const f of failed) console.error(`  ${f.categorySlug}: ${f.details.join(" / ")}`);
      process.exitCode = 1;
    }
  }
}

async function runOnline(datasetNames: string[], providerName: "simulated" | "openai") {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Mode --online : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { provider } = buildProvider(providerName);
  const asOf = new Date().toISOString();
  const runStartedAt = asOf;

  try {
    for (const name of datasetNames) {
      const dataset = loadDataset(path.join(DATASETS_DIR, `${name}.json`));
      console.log(`[online] ${name}: exécution de la pipeline d'ingestion réelle (source "benchmark" dédiée)...`);
      const result = await runDatasetOnline(supabase, dataset, { provider, asOf });
      const avg = (values: number[]) => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);
      console.log(
        `[online] ${name}: ${result.listingIds.length} lignes créées — ` +
          `persist=${avg(result.timingsMs.persist).toFixed(1)}ms, extract=${avg(result.timingsMs.extract).toFixed(1)}ms, analyze=${avg(result.timingsMs.analyze).toFixed(1)}ms (moyennes, mesures réelles Supabase)`,
      );
    }
  } finally {
    console.log("[online] Nettoyage des données de benchmark...");
    const report = await cleanupBenchmarkRun(supabase, { runStartedAt });
    console.log(`[online] Nettoyage : ${report.listingsDeleted} annonces, ${report.cacheRowsDeleted} entrées de cache IA supprimées.`);
    if (report.warnings.length > 0) {
      console.warn("[online] Avertissements de nettoyage (voir docs/benchmark.md) :");
      for (const w of report.warnings) console.warn(`  - ${w}`);
    }
  }
}

async function cleanupOnly() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("--cleanup-only : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const report = await cleanupBenchmarkRun(supabase, { runStartedAt: "1970-01-01T00:00:00.000Z" });
  console.log(`Nettoyage manuel : ${report.listingsDeleted} annonces, ${report.cacheRowsDeleted} entrées de cache IA supprimées.`);
  if (report.warnings.length > 0) {
    for (const w of report.warnings) console.warn(`  - ${w}`);
  }
}

function formatRate(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

function formatCost(cost: number | null): string {
  return cost === null ? "inconnu (modèle absent de COST_TABLE)" : `$${cost.toFixed(6)}`;
}

function printTcgMatrixMetrics(m: TcgMatrixMetrics) {
  console.log(`\n${m.matrixEntry.provider}/${m.matrixEntry.model} :`);
  console.log(
    `  exemples=${m.examplesTotal} succès=${m.successCount} erreurs_provider=${m.providerErrorCount} (${formatRate(m.providerErrorRate)}) réponse_invalide=${m.invalidJsonCount + m.invalidSchemaCount} (${formatRate(m.invalidResponseRate)})`,
  );
  console.log(
    `  identification_exacte=${formatRate(m.exactIdentificationAccuracy)} besoin_confirmation=${formatRate(m.needsConfirmationRate)} hallucination=${formatRate(m.hallucinationRate)}`,
  );
  console.log(
    `  confiance_élevée_mais_faux=${formatRate(m.falsePositiveRate)} confiance_insuffisante_mais_juste=${formatRate(m.falseNegativeRate)} ambiguïté=${formatRate(m.ambiguityRate)} succès_hybride=${formatRate(m.hybridSuccessRate)}`,
  );
  for (const field of m.fieldAccuracy) {
    console.log(`  précision.${field.field}=${formatRate(field.accuracy)} (${field.correct}/${field.evaluable})`);
  }
  for (const tagMetrics of m.byTag) {
    console.log(`  tag.${tagMetrics.tag}=${formatRate(tagMetrics.exactIdentificationAccuracy)} (${tagMetrics.successCount}/${tagMetrics.examplesTotal} succès)`);
  }
  console.log(`  latence_ms avg=${m.latencyMs.avg.toFixed(0)} median=${m.latencyMs.median.toFixed(0)} p95=${m.latencyMs.p95.toFixed(0)}`);
  console.log(`  coût_total=${formatCost(m.estimatedCostUsdTotal)} coût_par_identification=${formatCost(m.costPerSuccessfulIdentificationUsd)}`);
}

function printTcgReport(report: TcgBenchmarkReport) {
  console.log(`\n=== Benchmark TCG — mode ${report.mode} — ${report.datasetEntryCount} exemple(s), provenance "${report.datasetProvenance}" ===`);
  for (const m of report.matrices) printTcgMatrixMetrics(m);
  console.log(`\nDéterministe vs IA : ${report.deterministicVsAi.note}`);
}

function printTcgValidationReport(report: TcgDatasetValidationReport) {
  console.log(`\n=== Validation dataset TCG — ${report.datasetPath} ===`);
  console.log(`Statut : ${report.status} — ${report.entryCount} exemple(s), ${report.issues.length} problème(s) relevé(s).`);
  for (const issue of report.issues) {
    console.log(`  [${issue.severity}] ${issue.code}${issue.entryId ? ` (${issue.entryId})` : ""} : ${issue.message}`);
  }
  if (report.issues.length === 0) console.log("  Aucun problème détecté.");
}

async function main() {
  const argv = process.argv.slice(2);

  // "--validate-tcg-dataset=<nom>" (Phase 5, long lot local) — valide un
  // dataset exporté SANS l'exécuter à travers un provider, aucun appel
  // réseau, aucun coût. Chemin entièrement séparé du reste du CLI.
  const validateArg = argv.find((a) => a.startsWith("--validate-tcg-dataset="))?.split("=")[1];
  if (validateArg !== undefined) {
    const datasetPath = path.join(DATASETS_DIR, "tcg", `${validateArg}.json`);
    const report = validateTcgDataset(datasetPath);
    printTcgValidationReport(report);
    if (report.status === "INVALID") process.exitCode = 1;
    return;
  }

  // "--tcg" bascule vers l'évaluation multi-provider des cartes TCG (Phase
  // 6/7, ADR 0013) — chemin entièrement séparé du benchmark eBay existant
  // ci-dessous, jamais mélangé (dataset, métriques et vocabulaire différents).
  if (argv.includes("--tcg")) {
    const result = await runTcgCli(argv, DATASETS_DIR);
    if (result.kind === "empty_dataset") {
      console.log(`Dataset TCG "${result.datasetArg}" vide (aucune photo déposée) — voir packages/benchmark/datasets/tcg/README.md pour en ajouter.`);
      return;
    }
    printTcgReport(result.report);
    return;
  }

  if (!existsSync(BASELINE_DIR)) mkdirSync(BASELINE_DIR, { recursive: true });
  const args = parseArgs(argv);

  if (args.cleanupOnly) {
    await cleanupOnly();
    return;
  }

  await runOffline(args.datasets, args.providerName, args.saveBaseline);

  if (args.online) {
    await runOnline(args.datasets, args.providerName);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
