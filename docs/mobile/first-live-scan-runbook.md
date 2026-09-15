# Runbook — premier scan live ce soir (2026-09-15)

Court, opérationnel (Phase 55). Voir `docs/mobile/internal-build.md` pour
le détail de chaque étape déjà documentée.

## Étapes

1. **Débloquer `android/`** — vérifier que le verrou externe (documenté dans
   les rapports précédents) est levé : `Remove-Item apps/mobile/android -Force`
   ne doit plus échouer. Si toujours bloqué : redémarrer le PC.
2. **ADB Wi-Fi** — même réseau que le Samsung, `adb connect <ip>:<port>`
   (déjà appairé, GUID `adb-R3CX80BZHHY-aljQyC` — pas de nouvel appairage
   nécessaire, juste une IP/port frais après reconnexion Wi-Fi).
3. **Build + install APK** — `EXPO_PUBLIC_INTERNAL_TOOLS=true npx expo prebuild --clean --platform android` puis `./gradlew.bat app:assembleRelease -x lint -x test -PreactNativeArchitectures=arm64-v8a` (voir `docs/mobile/internal-build.md` pour le contournement `subst`/chemin long Windows), puis `adb install -r android/app/build/outputs/apk/release/app-release.apk`.
4. **Secret Groq côté Vercel** — poser `AI_PROVIDER=groq`, `AI_MODEL=qwen/qwen3.6-27b`, `GROQ_API_KEY=<clé gratuite console.groq.com>` dans les variables d'environnement du projet Vercel (jamais dans le repo, jamais dans le bundle mobile).
5. **Déployer** — redéployer `apps/web` sur Vercel pour que les nouvelles variables d'environnement soient prises en compte.
6. **Un scan réel** — ouvrir DealRadar Internal sur le Samsung → Scanner → photo d'une vraie carte → Analyser.
7. **Logs attendus** — côté Vercel (function logs de `/api/internal/tcg/analyze`) : aucune erreur, une réponse `200` avec `status: "completed"` ou `"insufficient_data"`. Côté app (si besoin) : Internal Tools → Diagnostics → "Dernière analyse — statut : success", durée renseignée.
8. **Si ça échoue — voir l'arbre de décision ci-dessous.**

## Arbre de décision (Phase 56)

- **Photo échoue avant même d'atteindre le backend** → `mobile/upload`
  (voir `api/tcg-upload-client.ts` — vérifier permission caméra/galerie,
  taille de l'image, session Supabase active).
- **Backend répond 4xx** → `request/auth` (jeton expiré, corps malformé —
  voir `route.ts`, `_errors.ts`).
- **Groq échoue** (résultat avec `reason` mentionnant l'extraction/le
  provider) → `provider` (vérifier la clé posée à l'étape 4, le quota
  Groq — `console.groq.com/docs/rate-limits`).
- **Identité non trouvée malgré une extraction réussie** →
  `extraction/catalog` (carte hors catalogue Pokémon TCG API/TCGdex, ou
  divergence catalogue).
- **Identité OK mais pas de prix** → `pricing` (TCGdex/JustTCG sans
  correspondance — **pas un échec**, voir Phase 8/13 : l'identité doit
  quand même s'afficher).
- **Backend répond 200 mais rien ne s'affiche côté app** → `mapping/mobile`
  (vérifier `result-view-model.ts`, la validation Zod de
  `tcg-analyze-client.ts` — un `INVALID_ANALYSIS_RESPONSE` visible à
  l'écran est déjà ce diagnostic, pas un bug supplémentaire à chercher).

## Ce qu'on ne fait PAS ce soir

Pas de nouvelle infra, pas de changement de provider IA, pas de
modification du pipeline métier — un scan raté doit d'abord être
diagnostiqué via l'arbre ci-dessus avant toute action corrective.
