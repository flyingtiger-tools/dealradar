import type { AggregateMetrics } from "../types";
import type { RegressionResult } from "../regression/baseline";

export interface ReportInput {
  generatedAt: string;
  providerLabel: string;
  mode: "offline" | "online";
  datasets: AggregateMetrics[];
  combined?: AggregateMetrics;
  regression?: RegressionResult[];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

/** Barres SVG horizontales simples — aucune dépendance externe, aucun CDN. */
function barChart(rows: Array<{ label: string; value: number }>, maxValue: number, unit: (v: number) => string): string {
  const barHeight = 22;
  const gap = 8;
  const labelWidth = 170;
  const chartWidth = 360;
  const height = rows.length * (barHeight + gap);
  const bars = rows
    .map((row, i) => {
      const y = i * (barHeight + gap);
      const w = maxValue > 0 ? Math.max(2, (row.value / maxValue) * chartWidth) : 2;
      return `
        <text x="0" y="${y + barHeight / 2 + 4}" font-size="12" fill="var(--fg)">${escapeHtml(row.label)}</text>
        <rect x="${labelWidth}" y="${y}" width="${w}" height="${barHeight}" fill="var(--accent)" rx="3"></rect>
        <text x="${labelWidth + w + 6}" y="${y + barHeight / 2 + 4}" font-size="12" fill="var(--fg)">${escapeHtml(unit(row.value))}</text>
      `;
    })
    .join("");
  return `<svg viewBox="0 0 ${labelWidth + chartWidth + 80} ${height + 4}" width="100%" height="${height + 4}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

function timingChart(metrics: AggregateMetrics): string {
  const rows = [
    { label: "Total", value: metrics.timingsMs.total.avg },
    { label: "Extraction", value: metrics.timingsMs.extraction.avg },
    { label: "  dont cache", value: metrics.timingsMs.cache.avg },
    { label: "  dont IA", value: metrics.timingsMs.provider.avg },
    { label: "Mapping", value: metrics.timingsMs.mapping.avg },
    { label: "Intelligence Core", value: metrics.timingsMs.intelligence.avg },
  ];
  const max = Math.max(...rows.map((r) => r.value), 1);
  return barChart(rows, max, ms);
}

function rateChart(metrics: AggregateMetrics): string {
  const rows = [
    { label: "Déterministe seul", value: metrics.rates.deterministicOnly },
    { label: "Appel IA", value: metrics.rates.aiCalled },
    { label: "Cache hit", value: metrics.rates.cacheHit },
    { label: "Contradiction majeure", value: metrics.rates.majorContradiction },
    { label: "Extraction invalide", value: metrics.rates.invalidExtraction },
    { label: "INSUFFICIENT_DATA", value: metrics.rates.insufficientData },
  ];
  return barChart(rows, 1, pct);
}

function datasetSection(metrics: AggregateMetrics): string {
  const precisionLabel = metrics.provenance === "synthetic" ? "Cohérence sur dataset synthétique" : "Performance sur dataset réel";
  const precisionValue = metrics.precisionAnnotee === null ? "non annoté" : pct(metrics.precisionAnnotee);

  const problemRows = metrics.problemListings
    .map((p) => `<tr><td>${escapeHtml(p.itemId)}</td><td>${escapeHtml(p.reason)}</td></tr>`)
    .join("");

  return `
    <section class="dataset">
      <h2>${escapeHtml(metrics.datasetLabel)} <span class="tag">${metrics.provenance}</span></h2>
      <p class="summary">
        ${metrics.usableListings}/${metrics.totalListings} annonces exploitables ·
        ${precisionLabel} : <strong>${precisionValue}</strong> ·
        Coût estimé moyen : $${metrics.costUsd.average.toFixed(6)} (total $${metrics.costUsd.total.toFixed(4)})
      </p>
      <div class="charts">
        <div><h3>Temps moyen par phase</h3>${timingChart(metrics)}</div>
        <div><h3>Taux</h3>${rateChart(metrics)}</div>
      </div>
      ${
        problemRows
          ? `<h3>Annonces à examiner (${metrics.problemListings.length})</h3>
             <table class="problems"><thead><tr><th>Annonce</th><th>Raison</th></tr></thead><tbody>${problemRows}</tbody></table>`
          : `<p class="ok">Aucune annonce à problème détectée.</p>`
      }
    </section>
  `;
}

function regressionSection(regression: RegressionResult[]): string {
  const rows = regression
    .map(
      (r) => `
      <tr class="${r.passed ? "pass" : "fail"}">
        <td>${escapeHtml(r.categorySlug)}</td>
        <td>${r.passed ? "✓ OK" : "✗ RÉGRESSION"}</td>
        <td>${r.details.map(escapeHtml).join("<br>")}</td>
      </tr>`,
    )
    .join("");
  return `
    <section>
      <h2>Non-régression (4 métriques de qualité uniquement)</h2>
      <p class="note">Latence, coût estimé et taux de cache hit sont affichés ci-dessus mais n'entrent jamais dans cette comparaison.</p>
      <table class="regression"><thead><tr><th>Catégorie</th><th>Statut</th><th>Détail</th></tr></thead><tbody>${rows}</tbody></table>
    </section>
  `;
}

export function renderReport(input: ReportInput): string {
  const provenances = new Set(input.datasets.map((d) => d.provenance));
  const provenanceWarning =
    provenances.size > 1
      ? `<p class="warning">⚠ Ce rapport contient des datasets de provenances différentes (${[...provenances].join(", ")}) — chaque section reste calculée séparément, jamais mélangée.</p>`
      : "";

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport de benchmark — DealRadar</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --accent: #2563eb;
    --border: #e5e7eb; --pass: #16a34a; --fail: #dc2626;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1115; --fg: #e5e7eb; --muted: #9ca3af; --accent: #60a5fa; --border: #262b36; }
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--fg); font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  h3 { font-size: 0.9rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 24px; }
  .tag { font-size: 0.7rem; text-transform: uppercase; background: var(--border); padding: 2px 6px; border-radius: 4px; margin-left: 6px; }
  section.dataset { margin-bottom: 32px; }
  .charts { display: flex; gap: 32px; flex-wrap: wrap; overflow-x: auto; }
  .charts > div { min-width: 300px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  table.problems, table.regression { overflow-x: auto; display: block; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
  .ok { color: var(--pass); }
  .warning { color: #b45309; font-weight: 600; }
  tr.fail td { color: var(--fail); font-weight: 600; }
  tr.pass td:nth-child(2) { color: var(--pass); }
  .note { color: var(--muted); font-size: 0.8rem; }
</style>
</head>
<body>
  <h1>Rapport de benchmark DealRadar — Lot 6</h1>
  <p class="meta">
    Généré le ${escapeHtml(input.generatedAt)} · Provider : ${escapeHtml(input.providerLabel)} ·
    Mode : ${input.mode === "online" ? "en ligne (Supabase réel)" : "hors ligne (aucune écriture DB)"}
  </p>
  ${provenanceWarning}
  ${input.combined ? datasetSection(input.combined) : ""}
  ${input.datasets.map(datasetSection).join("")}
  ${input.regression && input.regression.length > 0 ? regressionSection(input.regression) : ""}
</body>
</html>`;
}
