const { withXcodeProject, withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Config plugin iOS (ADR 0010) — ajoute une cible Share Extension au projet
 * Xcode généré par `expo prebuild`, et l'App Group nécessaire au passage de
 * données entre l'extension et l'app principale.
 *
 * NON VÉRIFIÉ DANS CE LOT : aucun Xcode/macOS disponible sur cette machine
 * (Windows). La manipulation de `project.pbxproj` ci-dessous suit le motif
 * établi pour l'ajout de cibles d'extension iOS, mais seule une exécution
 * réelle de `expo prebuild --platform ios` puis `xcodebuild`/Xcode sur
 * macOS peut confirmer qu'elle produit un projet qui compile — voir
 * docs/mobile/ios-share-extension.md, section « plan de test ».
 */
const EXTENSION_TARGET_NAME = "DealRadarShareExtension";
const APP_GROUP = "group.com.dealradar.mobile";
const EXTENSION_SOURCE_DIR = path.join(__dirname, "..", "ios", "ShareExtension");

function withShareExtensionAppGroup(config) {
  return withEntitlementsPlist(config, (config) => {
    const groups = config.modResults["com.apple.security.application-groups"] ?? [];
    if (!groups.includes(APP_GROUP)) groups.push(APP_GROUP);
    config.modResults["com.apple.security.application-groups"] = groups;
    return config;
  });
}

function withShareExtensionInfoPlist(config) {
  // L'Info.plist réel de la cible d'extension est copié depuis
  // ios/ShareExtension/Info.plist (voir withShareExtensionXcodeTarget) — ce
  // mod ne touche que l'Info.plist de l'app principale, laissé inchangé
  // volontairement (l'extension a son propre Info.plist, distinct).
  return withInfoPlist(config, (config) => config);
}

/**
 * Une cible d'extension iOS DOIT avoir un identifiant nesté sous celui de
 * l'app principale (`<app-bundle-id>.<suffixe>`), sans quoi Xcode/App Store
 * Connect rejettent la cible. Absent de la première version de ce plugin —
 * corrigé ici (trouvé en audit statique, jamais compilé pour le confirmer :
 * voir docs/mobile/ios-share-extension.md, statut UNVERIFIED).
 */
function extensionBundleIdentifier(config) {
  const mainBundleId = config.ios?.bundleIdentifier;
  if (!mainBundleId) {
    throw new Error("withIosShareExtension requires `ios.bundleIdentifier` to be set in app.config.ts.");
  }
  return `${mainBundleId}.ShareExtension`;
}

function withShareExtensionEntitlementsFile(config) {
  return withXcodeProject(config, (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const targetDir = path.join(projectRoot, "ios", EXTENSION_TARGET_NAME);
    fs.mkdirSync(targetDir, { recursive: true });

    const entitlementsPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP}</string>
  </array>
</dict>
</plist>
`;
    fs.writeFileSync(path.join(targetDir, `${EXTENSION_TARGET_NAME}.entitlements`), entitlementsPlist);
    return config;
  });
}

function withShareExtensionXcodeTarget(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectRoot = config.modRequest.projectRoot;
    const iosDir = path.join(projectRoot, "ios");
    const targetDir = path.join(iosDir, EXTENSION_TARGET_NAME);

    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of ["ShareViewController.swift", "Info.plist"]) {
      fs.copyFileSync(path.join(EXTENSION_SOURCE_DIR, file), path.join(targetDir, file));
    }

    const alreadyAdded = project.pbxTargetByName(EXTENSION_TARGET_NAME);
    if (alreadyAdded) return config;

    const target = project.addTarget(EXTENSION_TARGET_NAME, "app_extension", EXTENSION_TARGET_NAME);

    project.addBuildPhase(
      ["ShareViewController.swift"],
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid,
    );
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

    const bundleId = extensionBundleIdentifier(config);
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      if (!configurations[key].buildSettings) continue;
      if (configurations[key].buildSettings.PRODUCT_NAME !== `"${EXTENSION_TARGET_NAME}"`) continue;
      configurations[key].buildSettings.INFOPLIST_FILE = `${EXTENSION_TARGET_NAME}/Info.plist`;
      configurations[key].buildSettings.SWIFT_VERSION = "5.0";
      configurations[key].buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
      configurations[key].buildSettings.PRODUCT_BUNDLE_IDENTIFIER = bundleId;
      configurations[key].buildSettings.CODE_SIGN_ENTITLEMENTS = `${EXTENSION_TARGET_NAME}/${EXTENSION_TARGET_NAME}.entitlements`;
    }

    return config;
  });
}

function withIosShareExtension(config) {
  config = withShareExtensionAppGroup(config);
  config = withShareExtensionInfoPlist(config);
  config = withShareExtensionEntitlementsFile(config);
  config = withShareExtensionXcodeTarget(config);
  return config;
}

module.exports = withIosShareExtension;
