# Rapport de préparation bêta (Beta Readiness)

LOT "Product History UX + Source Health + Interactive Cancellation + Beta
Readiness", section 13. État exact de chaque sous-système du flux
scan → identification → intelligence de marché → résultat → historique →
cible de suivi → rafraîchissement, à la date de ce rapport
(2026-09-22, HEAD `40cf2bc`→ ce lot).

## Comment lire ce document

Quatre états seulement, jamais un cinquième inventé :

- **CONFIRMÉ** — vérifié RÉELLEMENT dans CETTE session (test exécuté, commande lancée, code lu ET exercé).
- **PRÊT MAIS NON TESTÉ EN CONDITIONS RÉELLES** — le code existe, typecheck/tests unitaires passent, mais aucune vérification contre une vraie instance Supabase/Railway/appareil physique n'a eu lieu ce lot.
- **BLOQUÉ EXTERNEMENT** — dépend d'une ressource externe (credential, plan payant, appareil) absente de cet environnement ; le code lui-même n'est pas en cause.
- **DIFFÉRÉ PAR POLITIQUE** — délibérément non activé par une décision produit/politique déjà documentée (`source-readiness-matrix.ts`), jamais un oubli.

## 1. Identification IA (extraction produit)

**BLOQUÉ EXTERNEMENT.** `activation-preflight` (exécuté ce lot) confirme
`aiProvider.status: "NOT_CONFIGURED"` — aucune variable `AI_PROVIDER`/
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GROQ_API_KEY`/`OPENROUTER_API_KEY`
posée dans cet environnement. Le repli 100% déterministe (sans IA) reste un
comportement valide et testé (voir logs des suites `workers`/`ingestion` de
ce lot : "extraction IA désactivée, repli 100% déterministe"), jamais un
blocage du reste du pipeline — mais l'extraction assistée par IA elle-même
n'a été exercée par AUCUN appel réel ce lot.

## 2. Worker / Railway (file `analysis.process`, rafraîchissement en arrière-plan)

**BLOQUÉ EXTERNEMENT.** Aucune connexion Railway/Supabase dans cet
environnement — confirmé par `activation-preflight`
(`migrations.status: "NOT_TESTED"`, `"Aucune connexion Supabase..."`). Les
lots précédents ont documenté (voir `docs/market-data-activation-checklist.md`)
que le worker Railway est hors service depuis un essai expiré, jamais payé —
statut inchangé ce lot, non réévalué (hors scope, ressource externe).
Conséquence produit honnête, déjà documentée dans le code
(`generic-object-adapter.ts`) : le chemin d'analyse générique interactif
timeout proprement après 60s si aucun worker ne traite la file, jamais un
faux résultat.

## 3. Migrations Supabase

**PRÊT MAIS NON TESTÉ EN CONDITIONS RÉELLES.** Migrations 0017 à 0026
committées sur la branche, **aucune appliquée à Production** (garde-fou
respecté, comme documenté pour 0017–0025 dans les lots précédents).
Migration 0026 (`analysis_cancellation`, ce lot) documente elle-même une
hypothèse non vérifiée : le nom de contrainte auto-généré
`analysis_requests_status_check` (à reconfirmer par `\d analysis_requests`
avant toute application réelle). Vérification structurelle CONFIRMÉE (le
SQL a été relu ligne par ligne, la RPC `request_analysis_cancellation` suit
le même patron `SECURITY DEFINER` + `auth.uid()` que le reste du schéma) —
mais **jamais exécutée contre une vraie instance Postgres ce lot**.

## 4. Sources de marché `productionAllowed`

**BLOQUÉ EXTERNEMENT** pour toutes, **DIFFÉRÉ PAR POLITIQUE** pour deux :

| Source | État confirmé ce lot (`activation-preflight`) |
| --- | --- |
| eBay | `missing_credentials` |
| Google Shopping (SerpApi) | `missing_credentials` |
| Google Shopping (DataForSEO) | `missing_credentials` |
| BrickLink | `missing_credentials` |
| Keepa | `missing_credentials` |
| PriceCharting | `license_required` — **DIFFÉRÉ PAR POLITIQUE**, jamais activable par une simple credential (voir `source-readiness-matrix.ts`) |
| Ricardo | `restricted` — **DIFFÉRÉ PAR POLITIQUE**, même règle |

Le mécanisme de sélection/routage (`buildSourceSelectionPlan`, santé par
source, section 4-5 de ce lot) est **CONFIRMÉ** par test unitaire
(deterministic, 13+4 cas dans `source-selection-plan.test.ts`), mais aucune
source réelle n'a été interrogée en réseau ce lot (aucune credential).

## 5. Conversion FX (Frankfurter)

**PRÊT MAIS NON TESTÉ EN CONDITIONS RÉELLES**, avec une correction réelle
ce lot : un audit (section 12) a trouvé et corrigé une divergence entre la
référence temporelle de la fusion (`asOf`) et celle utilisée pour juger la
péremption d'un taux FX (`mapMarketObservationsToFusionObservations`
utilisait l'horloge réelle même quand `asOf` était fourni) — désormais les
deux utilisent la MÊME référence (`orchestrate-market-intelligence.ts`,
`take-market-snapshot.ts`). **CONFIRMÉ** par les 17+9 tests des deux
fichiers concernés, qui échouaient de façon non-déterministe (flaky) avant
ce correctif à cause de cette même incohérence. Aucun appel réseau réel à
Frankfurter ce lot (pas de credential requise pour cette source, mais aucun
test d'intégration réseau n'a été relancé).

## 6. Résultat interactif générique (ResultScreen + MarketInsightCard)

**CONFIRMÉ** (au niveau code/tests, non au niveau appareil) : le chemin
`UniversalScanScreen.tsx` → `identifyCapture` → `generic-object-adapter.ts`
→ `AnalysisResult` → `RafAnalysis` (avec `productKey`/`marketEvidence`
désormais correctement reportés, bug corrigé lot précédent) →
`ResultScreen`/`MarketInsightCard` est exercé par 459 tests mobile qui
passent, y compris les scénarios limites ajoutés ce lot (retail-only,
active-only, historique clairsemé, 1 vs plusieurs sources, tendance
absente, fourchette extrême — voir `market-insight.test.ts`). **Jamais
rendu sur un appareil réel** (voir section 14).

## 7. Écran d'historique de prix (ProductHistoryScreen)

**CONFIRMÉ** (code/tests) avec une correction réelle ce lot : un audit a
trouvé que la carte "Couverture" (annonces actives suivies) était
entièrement masquée dès que `isEmpty` était vrai — même quand des annonces
actives ÉTAIENT suivies (`activeSupplyCount > 0`) — cachant une information
honnête et disponible. Corrigé : la carte "Couverture" est désormais
inconditionnelle, seuls le graphique/la valeur de référence/les tendances
restent conditionnés à `isEmpty` (aucun sens sans un échantillon de prix).
Testé structurellement + via `toProductHistoryDetailViewModel`. **Jamais
rendu sur un appareil réel.**

## 8. Boucle de rafraîchissement en arrière-plan

**PRÊT MAIS NON TESTÉ EN CONDITIONS RÉELLES** — inchangé par ce lot au
niveau architecture (santé par source désormais intégrée, section 4-5),
testable intégralement en local (`pnpm --filter @dealradar/workers test --
refresh-due-research-targets`, **CONFIRMÉ** ce lot, 14+1 tests passent).
Jamais invoquée contre une vraie base/un vrai cron — voir Stage A→E,
`docs/market-data-activation-checklist.md`, toujours au Stage A (rien
au-delà n'a été tenté).

## 9. Diagnostics opérateur (Internal Tools)

**CONFIRMÉ** (code/tests) — `OperatorDiagnosticsScreen.tsx` +
`GET /api/internal/operator/observability` étendus ce lot avec la santé
par source, âge du dernier succès/échec, comptes de timeout/erreur/abort,
cibles dues/en retard, dernier état de batch, disponibilité des migrations,
distinction claire READY/DEGRADED/BLOCKED/NOT CONFIGURED. **Bug réel trouvé
et corrigé lot précédent** dans ce même sous-système : le schéma Zod mobile
divergeait des noms de champs réels du serveur (aurait fait échouer
`safeParse` sur CHAQUE réponse réelle) — corrigé, testé (14 tests
`operator-observability.test.ts` + fixtures mobile/web alignées). Jamais
consulté contre un vrai serveur déployé.

## 10. Annulation interactive (nouveau ce lot)

**CONFIRMÉ** de bout en bout au niveau code/tests : migration 0026 +
`POST /v1/analyses/:id/cancel` (6 tests) + deux points de contrôle worker
dans `process-analysis.ts` (2 tests dédiés + suite complète 24 tests) +
`cancelAnalysis()`/`pollAnalysisUntilSettled({ signal })` côté mobile
(11 tests) + bouton "Annuler" dans `AnalysisLoadingScreen`
(`UniversalScanScreen.tsx`, structurellement testé) + garanties de
non-régression dans `beta-result-state.ts` (RESET depuis chaque phase en
vol, dispatch tardif ignoré). **Limite architecturale honnête** : le chemin
interactif étant asynchrone (file `pg-boss`), l'annulation SERVEUR est une
DEMANDE (`cancel_requested_at`) que le worker consulte lui-même avant ses
étapes coûteuses — jamais une interruption immédiate garantie si le worker
est déjà profondément engagé dans un appel réseau à un connecteur au moment
de la demande. Jamais exercée contre un vrai worker Railway (BLOQUÉ
EXTERNEMENT, voir section 2) ni sur un appareil réel (section 14).

## 11. Tests d'intégration DB (concurrence réelle du bail)

**BLOQUÉ EXTERNEMENT.** `activation-preflight` confirme
`dbIntegrationTests.status: "NOT_CONFIGURED"` — les 3 garde-fous requis
(`ALLOW_DB_INTEGRATION_TESTS`, `TEST_DATABASE_URL`,
`TEST_DATABASE_SUPABASE_URL`/`..._SERVICE_ROLE_KEY`) ne sont pas posés dans
cet environnement. Les 5 tests concurrents (`claim-research-target.db.test.ts`)
restent **SKIPPED**, honnêtement rapporté comme tel, jamais une fausse
réussite. Statut inchangé depuis les lots précédents.

## 12. QA sur appareil (Android/iOS réel)

**NON TESTÉ — aucun appareil connecté dans cette session.** Toutes les
vérifications de ce lot (annulation, historique, carte "Couverture" QA,
diagnostics internes) restent au niveau code/tests structurels/unitaires
uniquement. Aucune capture d'écran, aucune interaction tactile réelle,
aucun rendu React Native réel n'a eu lieu — non-bloquant pour ce lot (permis
explicitement), mais reste un vrai vide de confiance avant tout lancement
bêta réel.

## 13. Déploiement Production

**DIFFÉRÉ PAR POLITIQUE** (contrainte absolue de l'engagement, jamais
enfreinte) — aucun déploiement, aucune migration appliquée, aucune
activation Railway/cron par ce lot ni les précédents.

---

## Actions humaines EXACTES restantes (rien au-delà de ce qui est listé)

1. **Régler la facturation Railway** (worker de rafraîchissement/traitement de file) — bloque les sections 2, 8, 10 (annulation serveur réelle), 12 (tout test appareil contre un backend vivant).
2. **Provisionner au moins un fournisseur IA** (`AI_PROVIDER` + clé correspondante) pour exercer réellement l'extraction assistée — bloque la section 1.
3. **Appliquer les migrations 0017→0026** sur une base non-prod d'abord (Stage A, `docs/market-data-activation-checklist.md`), en confirmant le nom de contrainte réel de `analysis_requests` avant 0026 spécifiquement (`\d analysis_requests`).
4. **Provisionner au moins une credential de source de marché** (eBay/BrickLink/Keepa/SerpApi/DataForSEO) et lancer le test de fumée correspondant (section 5 du checklist) — bloque la section 4.
5. **Poser les 3 variables de test d'intégration DB** sur un projet Supabase JETABLE distinct pour exécuter les 5 tests de concurrence réelle du bail — bloque la section 11.
6. **Connecter un appareil Android/iOS réel** et exécuter manuellement : scan générique → résultat → "Voir l'historique" → retour ; scan + "Annuler" pendant upload/soumission/polling ; `OperatorDiagnosticsScreen` (build interne) — bloque la section 12.
7. **Suivre Stage A→E** (`docs/market-data-activation-checklist.md`) dans l'ordre avant d'envisager un cron Production — aucune étape sautée.

## Prochaines 3 tâches à plus haute valeur (au-delà de ce lot)

1. **Exécuter réellement le Stage A→D** du checklist d'activation contre une base non-prod jetable dès que les credentials Supabase sont disponibles — transformerait la quasi-totalité des "PRÊT MAIS NON TESTÉ" de ce rapport en "CONFIRMÉ", sans dépendre de Railway/IA.
2. **QA sur au moins un appareil réel** (section 12) — seul moyen de vérifier que les scénarios limites testés structurellement ce lot (labels longs, fourchette extrême, mode sombre) se comportent visuellement comme attendu.
3. **Politique de nettoyage réelle** (`docs/retention-policy.md`, section 11 de ce lot) : écrire le job de nettoyage qui consomme les helpers purs déjà écrits, avec ses propres tests d'intégration DB — actuellement seulement de la sélection pure, aucune suppression possible.
