import type { Session } from "@supabase/supabase-js";
import { useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import { BottomTabBar } from "./BottomTabBar";
import type { PushedScreen, RootTab } from "./types";
import { HomeScreen } from "../screens/HomeScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { FavoritesScreen } from "../screens/FavoritesScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { ScannerEntryScreen } from "../screens/ScannerEntryScreen";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { TcgDatasetCaptureTool } from "../screens/TcgDatasetCaptureTool";
import { UniversalCaptureBetaScreen } from "../screens/UniversalCaptureBetaScreen";
import { InternalToolsScreen } from "../screens/internal/InternalToolsScreen";
import { UiPreviewScreen } from "../screens/internal/UiPreviewScreen";
import { BuildInfoScreen } from "../screens/internal/BuildInfoScreen";
import { DiagnosticsScreen } from "../screens/internal/DiagnosticsScreen";
import { CopilotScreen } from "../screens/internal/CopilotScreen";
import { signOut } from "../auth/session";
import { colors } from "../theme/tokens";

export interface RootNavigatorProps {
  session: Session;
}

/**
 * Navigation consommateur (Phase 3, LOT "fondation produit Raf") — 5
 * onglets (Home/Scanner/Historique/Favoris/Profil) + une pile d'écrans
 * "poussés" pour Outils internes, jamais visible hors
 * `INTERNAL_TOOLS_ENABLED` (garde déjà faite dans `ProfileScreen`, qui
 * n'expose l'entrée "Outils internes" que sous ce flag — `RootNavigator`
 * ne duplique pas cette garde, il fait seulement confiance à l'appelant).
 *
 * Implémentation "maison" (état React, pas `@react-navigation`) —
 * volontairement, pour ne pas ajouter de dépendance native tant que le
 * build natif n'est pas vérifiable dans cet environnement (voir
 * `BottomTabBar.tsx`, docs/mobile/ui-product-foundation.md).
 */
export function RootNavigator({ session }: RootNavigatorProps) {
  const [activeTab, setActiveTab] = useState<RootTab>("home");
  const [pushed, setPushed] = useState<PushedScreen | null>(null);

  if (pushed) {
    // `edges` non disponible (pas `react-native-safe-area-context`) —
    // `SafeAreaView` du cœur RN respecte au moins l'encoche/la barre de
    // statut sur iOS ; sur Android c'est un no-op inoffensif (voir
    // BottomTabBar.tsx pour la marge basse Android).
    return <SafeAreaView style={styles.root}>{renderPushedScreen(pushed, setPushed)}</SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>{renderTab(activeTab, setActiveTab, setPushed, session)}</View>
      <BottomTabBar active={activeTab} onSelect={setActiveTab} />
    </SafeAreaView>
  );
}

function renderTab(
  tab: RootTab,
  setActiveTab: (tab: RootTab) => void,
  setPushed: (screen: PushedScreen | null) => void,
  session: Session,
) {
  switch (tab) {
    case "home":
      return <HomeScreen onOpenScanner={() => setActiveTab("scanner")} onOpenHistory={() => setActiveTab("history")} />;
    case "scanner":
      return <ScannerEntryScreen />;
    case "history":
      return <HistoryScreen onOpenScanner={() => setActiveTab("scanner")} />;
    case "favorites":
      return <FavoritesScreen onOpenHistory={() => setActiveTab("history")} />;
    case "profile":
      return <ProfileScreen session={session} onSignOut={() => void signOut()} onOpenInternalTools={() => setPushed("internalTools")} />;
  }
}

function renderPushedScreen(screen: PushedScreen, setPushed: (screen: PushedScreen | null) => void) {
  const back = () => setPushed(null);
  switch (screen) {
    case "internalTools":
      return (
        <InternalToolsScreen
          onOpenDatasetTcg={() => setPushed("datasetTcg")}
          onOpenUiPreview={() => setPushed("uiPreview")}
          onOpenBuildInfo={() => setPushed("buildInfo")}
          onOpenDiagnostics={() => setPushed("diagnostics")}
          onOpenUniversalCapture={() => setPushed("universalCapture")}
          onOpenCopilot={() => setPushed("copilot")}
          onOpenOnboardingPreview={() => setPushed("onboardingPreview")}
          onBack={back}
        />
      );
    case "datasetTcg":
      // Écran RÉEL inchangé (Phase 28 : ne pas casser Dataset TCG) — sa propre
      // garde `INTERNAL_TOOLS_ENABLED` reste en place à l'intérieur du composant.
      return <TcgDatasetCaptureTool onExit={back} />;
    case "universalCapture":
      // Écran RÉEL inchangé (Phase 29 : conserver le câblage réel, harmoniser
      // seulement l'UX — ce lot ne retouche pas son JSX aujourd'hui).
      return <UniversalCaptureBetaScreen onExit={back} />;
    case "copilot":
      return <CopilotScreen onBack={back} />;
    case "uiPreview":
      return <UiPreviewScreen onBack={back} />;
    case "buildInfo":
      return <BuildInfoScreen onBack={back} />;
    case "diagnostics":
      return <DiagnosticsScreen onBack={back} />;
    case "onboardingPreview":
      return <OnboardingScreen onDone={back} />;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
});
