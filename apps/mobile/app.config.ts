import type { ExpoConfig } from "expo/config";

/**
 * Development Build, pas Expo Go (ADR 0010) : les deux plugins ci-dessous
 * ajoutent des modules natifs custom (overlay/MediaProjection Android,
 * cible Share Extension iOS) qu'Expo Go ne peut pas héberger.
 *
 * `EXPO_PUBLIC_INTERNAL_TOOLS=true` (jamais défini par défaut — voir
 * docs/mobile/internal-build.md) bascule vers le build interne autonome :
 * package id ET nom distincts, pour cohabiter sur le même appareil avec le
 * build standard `com.dealradar.mobile` sans AUCUN conflit de signature
 * (deux package id différents = deux apps Android totalement indépendantes,
 * quelle que soit la clé de signature utilisée pour chacune).
 */
const isInternalBuild = process.env.EXPO_PUBLIC_INTERNAL_TOOLS === "true";
// APK de test GitHub signé séparément : identifiant distinct pour cohabiter
// avec les installations EAS existantes sans les désinstaller.
const isBetaApk = process.env.EXPO_PUBLIC_BETA_APK === "true";

const config: ExpoConfig = {
  name: isBetaApk ? "DealRadar Test" : isInternalBuild ? "DealRadar Internal" : "DealRadar",
  slug: "dealradar-copilot",
  version: "0.1.0",
  scheme: "dealradar",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: isInternalBuild ? "com.dealradar.mobile.internal" : "com.dealradar.mobile",
    // App Group requis pour le passage de données Share Extension → app
    // principale (voir plugins/withIosShareExtension.js). Non fonctionnel
    // sans compte Apple Developer réel — voir docs/mobile/ios-share-extension.md.
    entitlements: {
      "com.apple.security.application-groups": ["group.com.dealradar.mobile"],
    },
  },
  android: {
    package: isBetaApk ? "com.dealradar.mobile.test" : isInternalBuild ? "com.dealradar.mobile.internal" : "com.dealradar.mobile",
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
    // Déclare la permission caméra pour expo-camera (LOT "Universal Capture
    // Intake", ADR 0013) — module distinct d'expo-image-picker ci-dessus,
    // avec son propre plugin de config natif.
    [
      "expo-camera",
      {
        cameraPermission: "DealRadar utilise l'appareil photo pour capturer et identifier un objet.",
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
    // Identifiant public du projet EAS (`eas init`, LOT 8) — pas un secret,
    // sert uniquement à associer les builds au bon projet expo.dev.
    eas: {
      projectId: "43ef931b-5126-4828-ab49-8ba2a8db4396",
    },
  },
};

export default config;
