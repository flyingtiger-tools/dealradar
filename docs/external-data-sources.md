# Sources de données externes — statut MVP vs production commerciale

Stratégie actuelle (validée) : **vitesse vers un MVP fonctionnel d'abord**. Chaque
dépendance externe est choisie pour son quota gratuit suffisant au développement/
validation, jamais bloquée par une optimisation de licence commerciale — mais
toujours isolée derrière un connecteur (ADR 0012), donc remplaçable sans toucher
au reste du moteur. Ce document liste, pour chaque dépendance, ce qui change
concrètement le jour où DealRadar a un marché prouvé et passe en production
commerciale.

| Dépendance | Connecteur | Statut MVP | Ce qui change en commercial |
| --- | --- | --- | --- |
| eBay | `packages/connectors/src/ebay` | API Browse officielle, OAuth applicatif, déjà en Production réelle | Rien — déjà l'API officielle avec les bons scopes (ADR 0008) |
| Pokémon TCG API | `packages/connectors/src/catalogs/pokemon-tcg` | Gratuit, clé optionnelle (1 000→20 000 req/jour). `license.allowsCommercialUse: false` déclaré honnêtement (CGU inaccessibles au moment de l'implémentation) | Revérifier les CGU actuelles avant un usage commercial élargi ; si toujours bloquantes, chercher une alternative catalogue TCG ou négocier un accès |
| JustTCG | `packages/connectors/src/pricing/justtcg` | Palier gratuit (100 req/jour) suffisant pour valider le mapping catalogue↔pricing | Passer sur un palier payant (dès $19/mois) une fois le volume réel dépassant le quota gratuit — même connecteur, juste une clé API différente |
| Taux de change (USD→CHF/EUR) | `packages/connectors/src/fx/frankfurter` (défaut MVP) | **Frankfurter** — gratuit, aucune clé API, 84 banques centrales, taux BCE inclus | Basculer vers `packages/connectors/src/fx/openexchangerates` (déjà construit et testé, palier payant dès $12/mois) pour un statut commercial explicite et non ambigu — un seul changement d'instanciation, `FxRateProvider` est la même interface des deux côtés |
| PriceCharting | *(non implémenté)* | Bloqué : nécessite une autorisation écrite avant tout usage (scraping/contournement CGU explicitement exclu par instruction produit) | Reste bloqué indépendamment de cette stratégie MVP — ce n'est pas une question de coût mais d'autorisation d'accès |

## Principe

Chaque connecteur expose une interface stable (`CatalogConnector`, `PricingConnector`,
`FxRateProvider`, `MarketplaceConnector`) que le reste du code consomme — jamais un
appel HTTP direct vers un fournisseur depuis `packages/ingestion` ou `apps/workers`.
Remplacer un fournisseur MVP par son équivalent commercial est donc toujours un
changement d'instanciation à un seul endroit, jamais une réécriture.
