import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { itemConditionSchema, type Decision, type WhyFactor } from "@dealradar/core";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, formatDate } from "@/lib/format";
import { CONDITION_OPTIONS } from "@/lib/labels";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { StatePanel } from "@/components/ui/state-panel";
import { InsufficientDataNotice } from "@/components/ui/insufficient-data";
import { DecisionBadge } from "@/components/ui/decision-badge";

export const metadata: Metadata = { title: "Détail de l'annonce" };

const listingDetailRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  price_cents: z.number(),
  currency: z.string(),
  shipping_cost_cents: z.number().nullable(),
  condition: itemConditionSchema.nullable(),
  url: z.string().nullable(),
  external_id: z.string().nullable(),
  attributes: z.record(z.unknown()).nullable(),
  first_seen_at: z.string().nullable(),
  processing_status: z.enum(["collected", "normalized", "analyzed", "insufficient_data", "failed"]),
  categories: z.object({ name: z.string() }).nullable(),
  brands: z.object({ name: z.string() }).nullable(),
  sources: z.object({ name: z.string(), slug: z.string() }).nullable(),
});
type ListingDetailRow = z.infer<typeof listingDetailRowSchema>;

const intelligenceResultRowSchema = z.object({
  decision: z.enum(["BUY", "REVIEW", "PASS", "INSUFFICIENT_DATA"]),
  deal_score: z.number().nullable(),
  confidence_score: z.number(),
  liquidity_score: z.number(),
  why_panel: z.object({ summary: z.string(), factors: z.array(z.custom<WhyFactor>()) }),
  computed_at: z.string(),
});
type IntelligenceResultRow = z.infer<typeof intelligenceResultRowSchema>;

const conditionLabel = (value: ListingDetailRow["condition"]) =>
  CONDITION_OPTIONS.find((c) => c.value === value)?.label ?? null;

const FACTOR_MARKER: Record<WhyFactor["direction"], { glyph: string; className: string }> = {
  positive: { glyph: "+", className: "text-up" },
  negative: { glyph: "−", className: "text-down" },
  neutral: { glyph: "•", className: "text-muted" },
};

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("listings")
    .select(
      "id,title,price_cents,currency,shipping_cost_cents,condition,url,external_id,attributes,first_seen_at,processing_status,categories(name),brands(name),sources(name,slug)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!row) {
    return (
      <div className="space-y-6">
        <Link href="/search" className="text-sm text-muted underline underline-offset-4">
          ← Retour à la recherche
        </Link>
        <StatePanel title="Annonce introuvable" description="Cette annonce n'existe pas ou plus." />
      </div>
    );
  }

  const listing = listingDetailRowSchema.parse(row);

  const [{ data: mediaRows }, { data: intelligenceRow }] = await Promise.all([
    supabase.from("listing_media").select("source_url").eq("listing_id", id).order("position").limit(1),
    supabase
      .from("intelligence_results")
      .select("decision,deal_score,confidence_score,liquidity_score,why_panel,computed_at")
      .eq("listing_id", id)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const imageUrl = mediaRows?.[0]?.source_url ?? null;
  const intelligence = intelligenceRow ? intelligenceResultRowSchema.parse(intelligenceRow) : null;
  const attributes = Object.entries(listing.attributes ?? {}).filter(([, value]) => value !== null && value !== "");

  return (
    <div className="space-y-6">
      <Link href="/search" className="text-sm text-muted underline underline-offset-4">
        ← Retour à la recherche
      </Link>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[200px_1fr]">
        <div className="aspect-square w-full overflow-hidden rounded-lg border border-line bg-raised">
          {imageUrl ? (
            // Image externe (CDN eBay) — pas de domaine interne à optimiser via next/image ici.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={listing.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">Aucune image</div>
          )}
        </div>

        <div className="space-y-4">
          <h1 className="text-lg font-semibold">{listing.title}</h1>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Prix" value={formatPrice(listing.price_cents, listing.currency)} />
            <Stat
              label="Livraison"
              value={listing.shipping_cost_cents != null ? formatPrice(listing.shipping_cost_cents, listing.currency) : "—"}
            />
            <Stat label="État" value={conditionLabel(listing.condition) ?? "Non renseigné"} />
            <Stat label="Marketplace" value={listing.sources?.name ?? "—"} />
            <Stat label="Vu pour la première fois" value={formatDate(listing.first_seen_at)} />
            <Stat label="Identifiant externe" value={listing.external_id ?? "—"} />
          </div>

          {listing.url ? (
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-accent underline underline-offset-4"
            >
              Voir l&apos;annonce originale sur {listing.sources?.name ?? "le marketplace"} ↗
            </a>
          ) : null}

          {attributes.length > 0 ? (
            <div>
              <p className="mb-1 text-xs text-muted">Attributs</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                {attributes.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2 sm:block">
                    <dt className="text-muted">{key}</dt>
                    <dd className="truncate font-medium">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </div>

      <Card>
        <CardBody className="space-y-4">
          <h2 className="text-sm font-medium text-muted">Analyse</h2>
          <AnalysisSection processingStatus={listing.processing_status} intelligence={intelligence} />
        </CardBody>
      </Card>
    </div>
  );
}

function AnalysisSection({
  processingStatus,
  intelligence,
}: {
  processingStatus: ListingDetailRow["processing_status"];
  intelligence: IntelligenceResultRow | null;
}) {
  if (!intelligence) {
    if (processingStatus === "collected") {
      return (
        <StatePanel
          size="compact"
          title="En attente d'analyse"
          description="L'annonce a été récupérée mais l'analyse Intelligence Core n'a pas encore démarré."
        />
      );
    }
    if (processingStatus === "normalized") {
      return (
        <StatePanel
          size="compact"
          title="Analyse en cours"
          description="Les données de l'annonce ont été normalisées ; le calcul de la décision est la prochaine étape."
        />
      );
    }
    if (processingStatus === "failed") {
      return (
        <StatePanel
          size="compact"
          title="Analyse échouée"
          description="Une erreur est survenue pendant l'analyse de cette annonce. Aucun résultat n'est disponible."
        />
      );
    }
    return (
      <StatePanel
        size="compact"
        title="Analyse indisponible"
        description="Aucun résultat d'analyse n'a été trouvé pour cette annonce."
      />
    );
  }

  const decision: Decision = intelligence.decision;

  if (decision === "INSUFFICIENT_DATA") {
    return (
      <div className="space-y-4">
        <DecisionBadge value={decision} size="lg" />
        <InsufficientDataNotice
          description="Pas assez de ventes conclues comparables pour estimer une valeur de marché fiable. Aucune comparaison ni marge n'est affichée tant que cette donnée manque."
        />
        <WhyFactorsList factors={intelligence.why_panel.factors} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DecisionBadge value={decision} size="lg" />
      <p className="text-sm text-body">{intelligence.why_panel.summary}</p>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Deal score" value={intelligence.deal_score != null ? String(intelligence.deal_score) : "—"} />
        <Stat label="Confiance" value={`${intelligence.confidence_score}/100`} />
        <Stat label="Liquidité" value={`${intelligence.liquidity_score}/100`} />
      </div>
      <WhyFactorsList factors={intelligence.why_panel.factors} />
      <p className="text-2xs text-muted">Calculé le {formatDate(intelligence.computed_at)}</p>
    </div>
  );
}

function WhyFactorsList({ factors }: { factors: WhyFactor[] }) {
  if (factors.length === 0) return null;
  return (
    <ul className="space-y-2">
      {factors.map((factor) => {
        const marker = FACTOR_MARKER[factor.direction];
        return (
          <li key={factor.id} className="flex gap-2 text-sm">
            <span aria-hidden className={`font-data font-semibold ${marker.className}`}>
              {marker.glyph}
            </span>
            <span>
              <span className="font-medium">{factor.label}</span>
              <span className="text-muted"> — {factor.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
