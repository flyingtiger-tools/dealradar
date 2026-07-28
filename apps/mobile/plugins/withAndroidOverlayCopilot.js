const { AndroidConfig, withAndroidManifest, withGradleProperties } = require("expo/config-plugins");

const { getMainApplicationOrThrow } = AndroidConfig.Manifest;

const PERMISSIONS = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
  // Type par défaut de la bulle avant toute capture (voir withAndroidOverlayCopilot) —
  // permission distincte de FOREGROUND_SERVICE_MEDIA_PROJECTION, obligatoire dès
  // Android 14 pour ce type de service de premier plan.
  "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
  "android.permission.POST_NOTIFICATIONS",
];

/**
 * Config plugin Expo (ADR 0010) — déclare exactement les permissions et le
 * service documentés dans `docs/mobile/android-permissions.md`, rien de
 * plus. Le module natif lui-même vit dans `modules/overlay-copilot`
 * (autolinké via `expo-module.config.json`, référencé par
 * `overlay-copilot: file:./modules/overlay-copilot` dans package.json).
 */
/**
 * `expo-modules-core` (SDK 52.0.11) résout un Kotlin Compose Compiler qui
 * exige 1.9.25 mais peut se retrouver résolu à 1.9.24 sans cette
 * contrainte explicite — échec de compilation réel rencontré et corrigé en
 * construisant le spike (voir docs/mobile/readiness-audit.md). Fixé ici,
 * dans le config plugin, pour survivre à un futur `expo prebuild` — un
 * edit manuel de `android/gradle.properties` (généré) serait perdu.
 */
function withKotlinVersionFix(config) {
  return withGradleProperties(config, (config) => {
    const existing = config.modResults.find(
      (item) => item.type === "property" && item.key === "android.kotlinVersion",
    );
    if (existing) {
      existing.value = "1.9.25";
    } else {
      config.modResults.push({ type: "property", key: "android.kotlinVersion", value: "1.9.25" });
    }
    return config;
  });
}

function withAndroidOverlayCopilot(config) {
  config = withKotlinVersionFix(config);
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    manifest.manifest["uses-permission"] = manifest.manifest["uses-permission"] ?? [];

    for (const permission of PERMISSIONS) {
      const exists = manifest.manifest["uses-permission"].some(
        (entry) => entry.$["android:name"] === permission,
      );
      if (!exists) {
        manifest.manifest["uses-permission"].push({ $: { "android:name": permission } });
      }
    }

    const mainApplication = getMainApplicationOrThrow(manifest);
    mainApplication.service = mainApplication.service ?? [];
    const serviceName = "com.dealradar.overlaycopilot.OverlayBubbleService";
    const serviceEntry = {
      $: {
        "android:name": serviceName,
        "android:exported": "false",
        // Les deux types déclarés ici sont un plafond, pas un choix figé :
        // le service démarre en `specialUse` seul (bulle active, aucune
        // précondition), et n'est promu en `mediaProjection` qu'après
        // consentement effectif — voir OverlayBubbleService.promoteForCapture.
        // `specialUse` exige la <property> ci-dessous depuis Android 14.
        "android:foregroundServiceType": "mediaProjection|specialUse",
      },
      property: [
        {
          $: {
            "android:name": "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE",
            "android:value": "screen_capture_assistant_bubble",
          },
        },
      ],
    };
    // Idempotent : met à jour l'entrée existante plutôt que de l'ignorer —
    // une simple garde "déjà déclaré, donc rien à faire" avait figé le type
    // `mediaProjection` d'un run précédent, jamais mis à jour par la suite
    // (bug réel rencontré, corrigé en reconstruisant le spike).
    const existingIndex = mainApplication.service.findIndex((entry) => entry.$["android:name"] === serviceName);
    if (existingIndex >= 0) {
      mainApplication.service[existingIndex] = serviceEntry;
    } else {
      mainApplication.service.push(serviceEntry);
    }

    return config;
  });
}

module.exports = withAndroidOverlayCopilot;
