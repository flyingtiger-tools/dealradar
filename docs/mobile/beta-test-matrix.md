# Matrice de test bêta — scan carte Pokémon (2026-09-15)

Doc opérationnelle (LOT "beta product readiness", Phase 54). 15 scénarios
minimum couvrant le flux photo→prix et ses à-côtés (historique, favoris,
partage, persistance, sessions). Chaque scénario : précondition → action →
résultat attendu. Exécutable manuellement sur device, ou en partie déjà
couvert par des tests automatisés (référencés entre parenthèses).

## 1. Happy path photo

- **Précondition** : session active, `GROQ_API_KEY` configurée côté Vercel, carte Pokémon réelle sous la main.
- **Action** : Scanner → Prendre une photo → Analyser.
- **Attendu** : écran de chargement (2 phases réelles : "Envoi de la photo…" puis "Analyse en cours…"), puis résultat avec identité + au moins une source de prix. Entrée ajoutée à l'historique (Phase 44, `history/__tests__/save-result.test.ts`).

## 2. No price

- **Précondition** : carte identifiable mais sans correspondance de prix (ex. carte très récente/rare).
- **Action** : scan normal.
- **Attendu** : identité affichée (nom/set/numéro/confiance), bloc prix affiche "Carte identifiée — Prix temporairement indisponible" (jamais "Analyse échouée"). Historisée quand même (Phase 13/44).

## 3. No catalog match

- **Précondition** : photo d'un objet qui n'est pas une carte Pokémon, ou carte illisible.
- **Action** : scan.
- **Attendu** : `NO_MATCH` — "Carte non identifiée", suggestion de reprendre la photo ou saisir manuellement. Jamais historisée (Phase 44).

## 4. Low confidence

- **Précondition** : photo floue/mal cadrée d'une vraie carte.
- **Action** : scan.
- **Attendu** : soit `needsConfirmation` (champs pré-remplis à corriger), soit un résultat avec confiance faible affichée honnêtement (jamais un échec total, Phase 8 : "LOW_CONFIDENCE n'est pas forcément un échec complet").

## 5. Offline

- **Précondition** : mode avion activé avant de lancer l'analyse.
- **Action** : scan → Analyser.
- **Attendu** : `NETWORK_UNAVAILABLE` — "Pas de connexion", bouton "Réessayer" actif. Jamais historisée (Phase 44, testé : `tcg-analyze-client.test.ts`, "échec réseau").

## 6. Timeout

- **Précondition** : impossible à déclencher fiablement sur device (nécessiterait un serveur artificiellement lent) — couvert par test automatisé uniquement.
- **Action** : `analyzeTcgCard()` avec une réponse serveur qui ne vient jamais.
- **Attendu** : abandon après `TCG_ANALYZE_TIMEOUT_MS` (35s), `REQUEST_TIMEOUT` — "Analyse trop longue", retryable. Vérifié : `tcg-analyze-client.test.ts`.

## 7. Backend 500

- **Précondition** : couvert par test automatisé (`route.test.ts`, "exception inattendue du pipeline") — difficile à provoquer à la demande sur le serveur réel sans casser volontairement la config.
- **Attendu côté client** : `BACKEND_UNAVAILABLE` — "Service indisponible", retryable. Le serveur ne renvoie jamais de pile/détail interne (Phase 37/41, testé).

## 8. Malformed response

- **Précondition** : couvert par test automatisé (`tcg-analyze-client.test.ts`, "réponse 200 structurellement invalide").
- **Attendu** : `INVALID_ANALYSIS_RESPONSE` — "Impossible de lire le résultat de l'analyse", jamais un `undefined`/`NaN` affiché, jamais un `JSON.stringify` brut.

## 9. Retry

- **Précondition** : scénario 5 (offline) obtenu, puis réseau rétabli.
- **Action** : taper "Réessayer" depuis l'écran d'erreur.
- **Attendu** : nouvelle tentative manuelle (jamais de retry automatique agressif sur une requête IA, Phase 11), résultat normal si le réseau est bien revenu.

## 10. Historique

- **Précondition** : au moins un scan réussi effectué (scénario 1).
- **Action** : ouvrir l'onglet Historique.
- **Attendu** : la ou les analyses réussies apparaissent (produit, set/numéro, prix, date), triées du plus récent au plus ancien. Tap sur une ligne → détail (réutilise `ResultScreen`). Suppression d'un élément sans confirmation ; "Effacer tout" avec confirmation explicite (Phase 18).

## 11. Favoris

- **Précondition** : au moins une entrée d'historique.
- **Action** : depuis Historique ou Résultat, taper ♡ pour ajouter aux favoris.
- **Attendu** : l'icône devient ♥ immédiatement ; l'entrée apparaît dans l'onglet Favoris ; retirer le favori la fait disparaître de Favoris sans supprimer l'historique (Phase 19/20/21).

## 12. Partage

- **Précondition** : un résultat identifié affiché (avec ou sans prix).
- **Action** : taper "Partager".
- **Attendu** : feuille de partage native RN (`Share.share`) avec un texte du type "Pikachu — Base Set — #58\nValeur marché : ...\nAnalyse DealRadar" — jamais un prix inventé si absent (Phase 24/25).

## 13. Persistance au redémarrage

- **Précondition** : au moins une entrée d'historique/un favori créés.
- **Action** : fermer complètement l'app (pas juste la mettre en arrière-plan) puis la rouvrir.
- **Attendu** : l'historique et les favoris sont toujours là (fichier JSON local, `expo-file-system` — voir `history/storage.ts`, testé en simulation dans `history/__tests__/storage.test.ts`).

## 14. Logout/login

- **Précondition** : session active avec de l'historique local.
- **Action** : Profil → Déconnexion, puis se reconnecter (même compte ou un autre).
- **Attendu** : l'historique local N'EST PAS lié à la session (stockage fichier local, pas par utilisateur) — il reste visible après reconnexion, y compris avec un compte différent. **Limite connue, documentée ici plutôt que cachée** : ce lot n'a pas cloisonné l'historique par utilisateur (aucune démarche multi-utilisateur n'était demandée) — à revisiter si l'app doit un jour supporter plusieurs comptes sur le même appareil.

## 15. Internal tools masqués en prod

- **Précondition** : build grand public (`EXPO_PUBLIC_INTERNAL_TOOLS` non défini, hors `__DEV__`).
- **Action** : ouvrir Profil.
- **Attendu** : aucune entrée "Outils internes" visible (`INTERNAL_TOOLS_ENABLED` à `false`) — vérifié structurellement par `navigation/__tests__/structure-isolation.test.ts` (lot précédent) : aucune fixture DEMO importée hors `screens/internal/`, `ProfileScreen` ne rend l'entrée que sous le flag.
