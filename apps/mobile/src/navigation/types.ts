/** Les 5 onglets consommateur (Phase 3) — Dataset TCG et les autres outils internes n'y figurent JAMAIS. */
export type RootTab = "home" | "scanner" | "history" | "favorites" | "profile";

/**
 * Écrans "poussés" par-dessus la navigation principale — accessibles
 * uniquement depuis Profil → Outils internes (jamais depuis la barre
 * d'onglets). `datasetTcg`/`universalCapture`/`copilot` sont des écrans
 * RÉELS existants (jamais recréés), `uiPreview`/`buildInfo`/`internalTools`
 * sont nouveaux (Phases 14/15).
 */
export type PushedScreen =
  | "internalTools"
  | "datasetTcg"
  | "uiPreview"
  | "buildInfo"
  | "diagnostics"
  | "operatorDiagnostics"
  | "universalCapture"
  | "copilot"
  | "onboardingPreview";
