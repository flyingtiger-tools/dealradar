# Qualité de valorisation marché — calibration, confiance, observabilité

LOT "Data Quality Calibration + Operator Observability + Mobile Market
Insight Contract". Ce document explique comment lire et faire évoluer la
couche de calibration de qualité ajoutée à `fuseMarketObservations`
(`packages/core/src/intelligence/fuse-market-observations.ts`), comment
interroger la santé opérationnelle du moteur de rafraîchissement, et
comment mettre à jour le banc de benchmark sans en affaiblir les garanties.

## 1. Composantes de confiance (`confidenceComponents`)

`FusedValuation.confidenceComponents` (`ConfidenceComponents | null` — `null`
uniquement pour un résultat `insufficient`) décompose la confiance finale en
huit signaux, chacun 0–100 sauf mention contraire :

| Champ | Signification | Peut UNIQUEMENT... |
| --- | --- | --- |
| `evidenceQuality` | Dérivé du palier de preuve le plus fort (`strongestTier`, A→E) — le plafond historique (`TIER_CONFIDENCE_CAP`). | plafonner |
| `identity` | `FusionOptions.identityCertainty` (0–1, défaut neutre 1 si non fourni par l'appelant). | pénaliser |
| `diversity` | Nombre de sources/marchands distincts observés. | pénaliser |
| `freshness` | Ancienneté de la preuve la plus fraîche vs. demi-vie du palier. | pénaliser |
| `depth` | Taille d'échantillon (`evidenceCount`). | pénaliser |
| `agreement` | Inverse du coefficient de variation (dispersion) entre observations. | pénaliser |
| `fx` | `FusionOptions.fxReliability` (0–1, défaut neutre 1). | pénaliser |
| `condition` | Pénalité légère (jamais punitive) si l'état comparé est incertain/manquant. | pénaliser |
| `final` | Confiance résultante, toujours bornée par le plafond du palier le plus fort. | — |

**Règle de conception non négociable** : tout signal optionnel (`identity`,
`fx`, l'ajustement d'historique) est neutre par défaut et ne peut **jamais**
faire dépasser le plafond déjà imposé par `strongestTier` — il peut
seulement réduire la confiance en dessous. Cette règle est vérifiée par
`runBenchmarkRegressionChecks` (section 6) sur chaque fixture de benchmark.

## 2. Signaux de qualité déterministes (`qualityFlags`)

`FusedValuation.qualityFlags: QualityFlag[]` — chaque valeur a une condition
de déclenchement exacte et testée (`fuse-market-observations.test.ts`,
describe `qualityFlags`) :

| Flag | Déclenché quand... |
| --- | --- |
| `variant_conflict_filtered` | Au moins une observation écartée par `isCompatibleWithTarget` (variante/attribut incompatible). |
| `stale_evidence` | La preuve la plus fraîche dépasse la demi-vie du palier. |
| `retail_only` | Palier le plus fort = E (guide de prix retail uniquement). |
| `active_only` | Palier le plus fort = C ou D (annonces actives, aucune vente confirmée). |
| `low_source_diversity` | Moins de 2 sources/marchands distincts. |
| `high_dispersion` | Coefficient de variation au-delà du seuil (`cv > 0.35`). |
| `missing_condition` | Au moins une observation retenue sans état renseigné. |
| `fx_partial` | `FusionOptions.fxReliability` fourni et < 1 (conversion partiellement fiable). |
| `weak_identity` | `FusionOptions.identityCertainty` fourni et < 1. |
| `duplicated_origin_merged` | Un marchand dupliqué à travers plusieurs agrégateurs a été fusionné en une seule observation. |
| `specialist_only` | Uniquement des observations de palier B (spécialiste) — aucune vente confirmée ni annonce active. |
| `sparse_history` | `FusionOptions.history` fourni avec `sampleSize` faible. |

Ce sont des **booléens dérivés de conditions exactes**, jamais du texte
libre — toute traduction humaine (mobile, section 5) part de ces codes,
jamais l'inverse.

## 3. Historique comme ancre bornée (`FusionOptions.history`)

`fuseMarketObservations` accepte un `FusionHistoryContext` optionnel
(`historicalMedianCents`, `freshnessHours`, `trendDirection`, `confidence`,
`sampleSize`) — un résumé déjà calculé (jamais recalculé dans `fuse-market-
observations.ts`), typiquement produit par `computeHistoryIntelligenceV2`
(`@dealradar/core`) via `queryProductHistory` (`@dealradar/ingestion`,
section 4 ci-dessous).

Règles :

- L'historique ne stabilise **que** si la preuve live est fraîche
  (`< 3× halfLifeDays` heures), fiable (`confidence ≥ 40`), **et** que la
  preuve live est mince (`< 3` observations ou palier D/E) ou bruitée
  (`cv > 0.35`) — `HISTORY_MIN_CONFIDENCE_TO_ANCHOR`, section
  `applyHistoryStabilization`.
- Le déplacement est plafonné à 15 % de la valeur juste live
  (`MAX_HISTORY_SHIFT_FRACTION`) — jamais un remplacement.
- Une tendance forte influence la confiance/les raisons, **jamais** un
  déplacement de valeur juste par lui-même (pas de prédiction de momentum).
- **Aucune prédiction de prix futur, jamais.** `trendDescriptor` décrit
  uniquement `up`/`down`/`flat`/`insufficient` sur une fenêtre déjà passée.

`FusedValuation.historicalReferenceMedianCents` / `trendDescriptor` /
`trendConfidence` sont **toujours présents structurellement** (jamais
`undefined`), mais restent `null` tant qu'aucun `history` n'a été fourni à
l'appel — voir section 7 pour l'état actuel du câblage côté chemin
interactif.

## 4. Condition normalisée (`normalizeCondition`)

`packages/core/src/intelligence/condition-normalization.ts` — corrige un bug
latent réel : `isCompatibleWithTarget` comparait `condition` par égalité de
chaîne STRICTE, donc `"new"` (eBay) et `"brand new"` (Google Shopping)
s'excluaient mutuellement malgré une équivalence sémantique.

7 paliers canoniques : `new_sealed`, `like_new`, `very_good`, `good`, `fair`,
`poor_for_parts`, `unknown`. Les adaptateurs par catégorie peuvent ajouter du
détail mais doivent toujours retomber sur un de ces 7 paliers. Jamais de
fusion silencieuse scellé/neuf avec occasion ; jamais d'état deviné à partir
de l'absence de source.

## 5. Prix atterri (item + port) comme base de fusion

`packages/ingestion/src/map-market-observations-to-fusion.ts` —
`landedPriceCents()` préfère `observation.totalPriceCents` (quand connu) à
`priceAmountCents` seul. Le prix brut article et le port restent conservés
séparément dans l'observation d'origine ; seule la base de comparaison pour
la fusion change. Garde-fou statique (`shipping-consistency.test.ts`,
`packages/connectors`) : seul `ebay` calcule aujourd'hui `totalPriceCents` —
toute future addition d'un second connecteur doit être ajoutée
explicitement à `KNOWN_TOTAL_PRICE_COMPUTERS`, sous peine de faire échouer
ce test (garde contre un double comptage silencieux du port par un
agrégateur qui inclurait déjà le total).

## 6. Banc de benchmark et porte de régression

`packages/core/src/intelligence/__tests__/valuation-benchmark-fixtures.ts` —
7 fixtures déterministes (iPhone, console, LEGO, sneaker, montre, objet de
collection retail-only, un cas TCG-adjacent qui **n'importe jamais** le
pipeline TCG réel). `runBenchmarkRegressionChecks` (`benchmark-regression-
gate.ts`) tourne sur CHAQUE fixture (`valuation-benchmark.test.ts`) et
vérifie des invariants transverses : jamais de variante incompatible
retenue, jamais une confiance retail-only au-dessus du plafond, jamais un
marchand dupliqué compté deux fois, jamais une disparition d'annonce traitée
comme une vente, jamais un flag FX obsolète ignoré.

**Mettre à jour un benchmark délibérément** : si un changement légitime de
fusion/connecteur doit modifier le résultat attendu d'une fixture, éditez la
fixture elle-même (`valuation-benchmark-fixtures.ts`) avec une justification
en commentaire, jamais le seuil dans `benchmark-regression-gate.ts`. Le
gate lui-même ne doit **jamais** être assoupli pour faire passer un
changement — s'il échoue, soit la fixture doit changer avec une raison
explicite, soit le changement de fusion est un vrai regard.

## 7. Contrat mobile (`marketEvidence`, `marketInsight`)

`AnalysisResult.marketEvidence` (`@dealradar/contracts`) porte maintenant,
en plus des champs existants (palier le plus fort, nombre de sources,
avertissements retail/active-only...) : `qualityFlags: string[]`,
`historicalReferenceMedianCents`, `trendDescriptor`, `trendConfidence` — des
champs **tous optionnels** au niveau schéma pour rester rétrocompatibles.

Ces champs sont portés **tels quels** depuis `FusedValuation` par
`apps/workers/src/jobs/process-analysis.ts` — jamais recalculés côté
worker. **État actuel honnête** : le chemin d'analyse interactif n'appelle
pas encore `queryProductHistory` pour construire un `FusionHistoryContext`
avant fusion — donc `trendDescriptor`/`trendConfidence`/
`historicalReferenceMedianCents` restent `null` en pratique aujourd'hui,
même si `qualityFlags` (qui ne dépendent pas de l'historique) sont déjà
peuplés pour de vrai. Câbler `queryProductHistory` dans le chemin interactif
est une extension naturelle pour un lot futur (voir BUILDER HANDOFF).

Côté mobile, `apps/mobile/src/screens/result/from-analysis-result-view-model.ts`
traduit `marketEvidence` en `ResultMarketInsight` (`result-view-model.ts`) :
fourchette de valeur juste, confiance, nombre de sources, palier le plus
fort, tendance, avertissements retail/active-only, et les `qualityFlags`
traduits en libellés français courts (`QUALITY_FLAG_LABELS`) — jamais les
codes bruts affichés. `null` pour tout flux qui ne produit pas de
`marketEvidence` (TCG, historique, RAF, DEMO) — jamais une valeur devinée.

## 8. Observabilité opérateur (lecture seule)

`packages/ingestion/src/operator-observability.ts`
(`getOperatorObservabilitySummary`) et `query-product-history.ts`
(`queryProductHistory`) — services de LECTURE SEULE, jamais d'écriture,
composés à partir de briques déjà existantes/testées
(`computeHistoryIntelligenceV2`, `queryHistoricalPricePoints`). Aucun
secret, aucune URL brute jamais retournée — voir le test dédié
(`operator-observability.test.ts`, assertion `not.toMatch(/api[_-]?key/i)`
sur le JSON complet du résumé).

`check-historical-engine-availability.ts` — sonde en lecture seule
(`limit(0)`) l'existence des 8 tables requises par le moteur d'historique.
**Décision de portée explicite (section 9 du lot)** : l'écran de
diagnostics internes mobile reste différé à un lot futur ; seul le contrat
API/requête est livré et testé ici.
