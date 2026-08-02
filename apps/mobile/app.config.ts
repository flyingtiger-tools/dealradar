import type { ExpoConfig } from "expo/config";

/**
 * Development Build, pas Expo Go (ADR 0010) : les deux plugins ci-dessous
 * ajoutent des modules natifs custom (overlay/MediaProjection Android,
 * cible Share Extension iOS) qu'Expo Go ne peut pas héberger.
 */
const config: ExpoConfig = {
  name: "DealRadar Copilot",
  slug: "dealradar-copilot",
  version: "0.1.0",
  scheme: "dealradar",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.dealradar.mobile",
    // App Group requis pour le passage de données Share Extension → app
    // principale (voir plugins/withIosShareExtension.js). Non fonctionnel
    // sans compte Apple Developer réel — voir docs/mobile/ios-share-extension.md.
    entitlements: {
      "com.apple.security.application-groups": ["group.com.dealradar.mobile"],
    },
  },
  android: {
    package: "com.dealradar.mobile",
    permissions: [
      // Ajoutées explicitement par withAndroidOverlayCopilot — listées ici
      // pour lisibilité, la valeur de vérité reste le config plugin.
    ],
  },
  plugins: [
    "expo-dev-client",
    "./plugins/withAndroidOverlayCopilot",
    "./plugins/withIosShareExtension",
    // Déclare CAMERA/READ_MEDIA_IMAGES (Android) et les chaînes de
    // permission iOS (NSCameraUsageDescription/NSPhotoLibraryUsageDescription)
    // — sans ce plugin, `expo-image-picker` n'ajoute pas ces déclarations au
    // manifeste/Info.plist générés (LOT 8, scan photo carte Pokémon).
    [
      "expo-image-picker",
      {
        cameraPermission: "DealRadar utilise l'appareil photo pour identifier une carte Pokémon que vous photographiez.",
        photosPermission: "DealRadar accède à vos photos pour identifier une carte Pokémon que vous importez.",
      },
    ],
  ],
  extra: {
    // URL de l'API — jamais un secret ici (ADR 0010, aucun secret dans le client mobile).
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000",
    // URL du projet Supabase + clé publique "anon" (protégée par RLS, jamais
    // une clé service-role) — même règle "aucun secret dans le client
    // mobile" : la clé anon est conçue pour être publique (LOT 8).
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  },
};

export default config;
