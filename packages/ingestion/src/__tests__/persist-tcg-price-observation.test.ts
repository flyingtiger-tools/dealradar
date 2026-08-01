import { describe, expect, it } from "vitest";
import type { TcgCanonicalIdentity, TcgCrossMatchResult } from "@dealradar/connectors";
import type { NormalizedPriceObservation } from "@dealradar/connectors";
import { persistTcgPriceObservation } from "../persist-tcg-price-observation";
import { FakeSupabase } from "./fake-supabase";

const CATEGORY_SLUG = "pokemon_tcg";

function identity(overrides: Partial<TcgCanonicalIdentity> = {}): TcgCanonicalIdentity {
  return {
    game: "pokemon",
    setName: "Base Set",
    setCode: "base4",
    cardName: "Pikachu",
    cardNumber: "58",
    variant: "Normal",
    language: "English",
    productKind: "raw_card",
    isGraded: false,
    gradingCompany: null,
    grade: null,
    catalogSource: "pokemon-tcg-api",
    catalogExternalId: "base4-58",
    confidence: 1,
    warnings: [],
    ...overrides,
  };
}

function observation(overrides: Partial<NormalizedPriceObservation> = {}): NormalizedPriceObservation {
  return {
    source: "justtcg",
    externalProductId: "v_normal",
    game: "Pokémon",
    name: "Pikachu",
    setName: "Base Set",
    setId: "base4",
    number: "58",
    variant: "Normal",
    language: "English",
    condition: "Near Mint",
    gradingCompany: null,
    grade: null,
    amountCents: 150,
    currency: "USD",
    priceType: "market_aggregate",
    updatedAt: "2026-07-30T00:00:00.000Z",
    region: "US",
    provenance: "justtcg-api-v2",
    confidence: 1,
    warnings: ["Prix en USD, marché nord-américain (JustTCG) — ne représente pas une valeur de marché suisse ou européenne."],
    ...overrides,
  };
}

function exactMatch(overrides: {
  identity?: Partial<TcgCanonicalIdentity>;
  observation?: Partial<NormalizedPriceObservation>;
  confidence?: number;
  warnings?: string[];
} = {}): TcgCrossMatchResult {
  return {
    outcome: "exact_match",
    identity: identity(overrides.identity),
    priceObservations: [observation(overrides.observation)],
    confidence: overrides.confidence ?? 1,
    warnings: overrides.warnings ?? [],
  };
}

describe("persistTcgPriceObservation — refus des correspondances non exactes", () => {
  it("refuse un probable_match, n'écrit rien", async () => {
    const supabase = new FakeSupabase();
    const result: TcgCrossMatchResult = { outcome: "probable_match", identity: identity(), priceObservations: [observation()], confidence: 0.8, warnings: ["Langue non confirmée"] };

    const outcomes = await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, result);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.outcome).toBe("refused");
    expect(outcomes[0]!.reason).toMatch(/probable_match/);
    expect(supabase.table("tcg_price_observations")).toHaveLength(0);
  });

  it("refuse un ambiguous, n'écrit rien", async () => {
    const supabase = new FakeSupabase();
    const result: TcgCrossMatchResult = {
      outcome: "ambiguous",
      identity: identity(),
      priceObservations: [observation(), observation({ externalProductId: "v_holo", amountCents: 500 })],
      confidence: 1,
      warnings: ["Plusieurs candidats équivalents"],
    };

    const outcomes = await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, result);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.outcome).toBe("refused");
    expect(outcomes[0]!.reason).toMatch(/ambiguous/);
    expect(supabase.table("tcg_price_observations")).toHaveLength(0);
  });

  it("refuse un no_match, n'écrit rien", async () => {
    const supabase = new FakeSupabase();
    const result: TcgCrossMatchResult = { outcome: "no_match", identity: identity(), priceObservations: [], confidence: 0, warnings: ["Refus : mauvais set"] };

    const outcomes = await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, result);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.outcome).toBe("refused");
    expect(outcomes[0]!.reason).toMatch(/no_match/);
    expect(supabase.table("tcg_price_observations")).toHaveLength(0);
  });
});

describe("persistTcgPriceObservation — persistance d'un exact_match", () => {
  it("insère une nouvelle observation", async () => {
    const supabase = new FakeSupabase();

    const outcomes = await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch());

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.outcome).toBe("inserted");
    expect(supabase.table("tcg_price_observations")).toHaveLength(1);
    const row = supabase.table("tcg_price_observations")[0]!;
    expect(row.source).toBe("justtcg");
    expect(row.catalog_source).toBe("pokemon-tcg-api");
    expect(row.catalog_external_id).toBe("base4-58");
    expect(row.category_slug).toBe("pokemon_tcg");
    expect(row.amount_cents).toBe(150);
    expect(row.match_outcome).toBe("exact_match");
  });

  it("doublon : un rerun identique ne crée aucune nouvelle ligne", async () => {
    const supabase = new FakeSupabase();
    await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch());
    const second = await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch());

    expect(second).toHaveLength(1);
    expect(second[0]!.outcome).toBe("unchanged");
    expect(supabase.table("tcg_price_observations")).toHaveLength(1);
  });

  it("changement de prix : une nouvelle ligne d'historique est créée, l'ancienne reste", async () => {
    const supabase = new FakeSupabase();
    await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch());
    const second = await persistTcgPriceObservation(
      supabase as never,
      CATEGORY_SLUG,
      exactMatch({ observation: { amountCents: 175 } }),
    );

    expect(second).toHaveLength(1);
    expect(second[0]!.outcome).toBe("inserted");
    expect(supabase.table("tcg_price_observations")).toHaveLength(2);
    expect(supabase.table("tcg_price_observations").map((r) => r.amount_cents).sort()).toEqual([150, 175]);
  });

  it("brut vs gradé : jamais fusionnés, même carte, deux lignes distinctes", async () => {
    const supabase = new FakeSupabase();
    await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch());
    await persistTcgPriceObservation(
      supabase as never,
      CATEGORY_SLUG,
      exactMatch({
        identity: { productKind: "graded_card", isGraded: true, gradingCompany: "PSA", grade: "10" },
        observation: { externalProductId: "v_psa10", gradingCompany: "PSA", grade: "PSA 10", condition: null, amountCents: 12_000_00 },
      }),
    );

    const rows = supabase.table("tcg_price_observations");
    expect(rows).toHaveLength(2);
    const raw = rows.find((r) => r.product_kind === "raw_card")!;
    const graded = rows.find((r) => r.product_kind === "graded_card")!;
    expect(raw.grading_company).toBe("");
    expect(graded.grading_company).toBe("PSA");
    expect(graded.grade).toBe("PSA 10");
  });

  it("variante différente : Normal et Holofoil restent deux lignes distinctes", async () => {
    const supabase = new FakeSupabase();
    await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch());
    await persistTcgPriceObservation(
      supabase as never,
      CATEGORY_SLUG,
      exactMatch({
        identity: { variant: "Holofoil" },
        observation: { externalProductId: "v_holo", variant: "Holofoil", amountCents: 500 },
      }),
    );

    const rows = supabase.table("tcg_price_observations");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.variant).sort()).toEqual(["Holofoil", "Normal"]);
  });

  it("langue différente : English et Japanese restent deux lignes distinctes", async () => {
    const supabase = new FakeSupabase();
    await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch());
    await persistTcgPriceObservation(
      supabase as never,
      CATEGORY_SLUG,
      exactMatch({
        identity: { language: "Japanese" },
        observation: { externalProductId: "v_jp", language: "Japanese", amountCents: 90 },
      }),
    );

    const rows = supabase.table("tcg_price_observations");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.language).sort()).toEqual(["English", "Japanese"]);
  });

  it("devise différente : jamais fusionnée ni convertie, deux lignes distinctes", async () => {
    const supabase = new FakeSupabase();
    await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch());
    await persistTcgPriceObservation(
      supabase as never,
      CATEGORY_SLUG,
      exactMatch({ observation: { externalProductId: "v_normal_chf", currency: "CHF", amountCents: 140 } }),
    );

    const rows = supabase.table("tcg_price_observations");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.currency).sort()).toEqual(["CHF", "USD"]);
    // Aucune conversion : les deux montants restent tels que fournis par la source.
    expect(rows.map((r) => r.amount_cents).sort()).toEqual([140, 150]);
  });

  it("région différente : jamais fusionnée, deux lignes distinctes", async () => {
    const supabase = new FakeSupabase();
    await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch());
    await persistTcgPriceObservation(
      supabase as never,
      CATEGORY_SLUG,
      exactMatch({ observation: { externalProductId: "v_normal_na", region: "NA", amountCents: 150 } }),
    );

    const rows = supabase.table("tcg_price_observations");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.region).sort()).toEqual(["NA", "US"]);
  });

  it("avertissements cross-market conservés intégralement", async () => {
    const supabase = new FakeSupabase();
    const warning = "Prix en USD, marché nord-américain (JustTCG) — ne représente pas une valeur de marché suisse ou européenne.";

    await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, exactMatch({ warnings: [warning] }));

    const row = supabase.table("tcg_price_observations")[0]!;
    expect(row.warnings).toEqual([warning]);
  });

  it("LOT 7C — un seul exact_match avec plusieurs observations (EUR + USD) : chacune persistée séparément en un seul appel", async () => {
    const supabase = new FakeSupabase();
    const result: TcgCrossMatchResult = {
      outcome: "exact_match",
      identity: identity(),
      priceObservations: [
        observation({ source: "tcgdex", externalProductId: "tcgdex-eur", currency: "EUR", amountCents: 500, provenance: "tcgdex-cardmarket" }),
        observation({ source: "tcgdex", externalProductId: "tcgdex-usd", currency: "USD", amountCents: 650, provenance: "tcgdex-tcgplayer" }),
      ],
      confidence: 1,
      warnings: [],
    };

    const outcomes = await persistTcgPriceObservation(supabase as never, CATEGORY_SLUG, result);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.outcome === "inserted")).toBe(true);
    const rows = supabase.table("tcg_price_observations");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.currency).sort()).toEqual(["EUR", "USD"]);
    expect(rows.map((r) => r.amount_cents).sort()).toEqual([500, 650]);
    expect(rows.every((r) => r.amount_cents !== 575)).toBe(true);
  });
});
