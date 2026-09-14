/**
 * Active les outils dev internes (actuellement : l'outil "TCG Dataset
 * Capture") — soit en Development Build classique (`__DEV__`, inchangé),
 * soit dans le build interne autonome explicite marqué
 * `EXPO_PUBLIC_INTERNAL_TOOLS=true` à la compilation (voir
 * `docs/mobile/internal-build.md`).
 *
 * `__DEV__` reste `false` dans TOUT build release (y compris le build
 * interne, qui EST un build release signé — seulement avec un package id
 * distinct, voir `app.config.ts`) — sans ce second flag, aucun moyen
 * d'exposer Dataset TCG dans un APK autonome sans Metro. Le flag inverse
 * n'est JAMAIS défini dans un build grand public (aucun fichier `.env*`
 * commité ne le positionne, aucune valeur par défaut ici) : il doit être
 * explicitement exporté dans le shell qui lance CE build précis, jamais
 * hérité silencieusement d'un `NODE_ENV=production` générique — un futur
 * vrai build public passe aussi par `NODE_ENV=production` et ne doit
 * jamais activer cet outil par accident.
 */
export const INTERNAL_TOOLS_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_INTERNAL_TOOLS === "true";
