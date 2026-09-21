import { createFrankfurterProvider, createCachedFxRateProvider } from "@dealradar/connectors";

/**
 * Fournisseur FX partagé du process workers (LOT "Source Wave 3", section
 * 1) — Frankfurter : gratuit, aucune clé/authentification à poser (même
 * choix que le MVP FX déjà en place pour la verticale TCG, voir
 * `docs/fx-provider-swap.md`), donc TOUJOURS disponible sans configuration
 * supplémentaire, contrairement à chaque source de marché elle-même.
 * Enveloppé dans un cache TTL borné (15 min par défaut) au niveau MODULE —
 * un seul processus workers sert potentiellement de nombreuses analyses/
 * instantanés, le cache doit survivre entre eux, jamais recréé à chaque
 * appel. Point de vérité UNIQUE (`process-analysis.ts` et `take-product-
 * snapshot.ts` partagent la même instance, jamais deux caches distincts).
 */
export const sharedFxRateProvider = createCachedFxRateProvider(createFrankfurterProvider());
