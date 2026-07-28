/**
 * Déduplication par `notificationId` (ADR 0011) — eBay retente une
 * notification tant qu'il n'obtient pas 200 rapidement ; sans cette garde,
 * un retry (ou une livraison dupliquée) relancerait l'anonymisation deux
 * fois. Le résultat de `anonymizeEbaySellerData` est déjà idempotent en
 * lui-même (voir data-deletion.ts), donc un doublon non filtré ici ne
 * corromprait rien — cette déduplication évite simplement du travail et
 * des écritures redondantes, ce n'est pas la seule garantie de sûreté.
 * C'est l'**idempotence de l'anonymisation** qui est la vraie garantie ;
 * cette déduplication mémoire n'est qu'une optimisation best-effort.
 *
 * **`hasSeen`/`markSeen` séparés à dessein** (round 4) : marquer un
 * `notificationId` comme traité doit arriver **uniquement après un
 * traitement réussi**, jamais avant, jamais sur un échec. Une version
 * antérieure enregistrait l'ID dès réception, avant même la vérification
 * de signature ou l'anonymisation — un échec (erreur Supabase, timeout)
 * marquait quand même l'ID comme "vu", bloquant silencieusement toute
 * nouvelle tentative légitime derrière un faux `acknowledged` côté eBay.
 * Séparer les deux corrige ce défaut : un échec ne marque rien, une
 * nouvelle tentative peut réussir normalement.
 *
 * **Limite assumée, documentée** : ce store est en mémoire, par instance de
 * processus. Sur un déploiement serverless multi-instance (ex. Vercel),
 * deux invocations concurrentes sur des instances différentes ne partagent
 * pas ce cache — une notification pourrait donc être traitée plus d'une
 * fois à travers des instances différentes (mais jamais de façon
 * dommageable, grâce à l'idempotence de `anonymizeEbaySellerData`). Une
 * table Postgres partagée éliminerait cette limite ; non construite ici
 * (aucune migration sans accord explicite) — voir la proposition de
 * migration dans l'ADR 0011.
 */
export interface NotificationDedupStore {
  /** `true` si déjà vu (et toujours dans la fenêtre TTL) — ne modifie jamais l'état, un simple contrôle. */
  hasSeen(notificationId: string): boolean;
  /** Marque explicitement comme traité — à appeler uniquement après un traitement réussi confirmé. */
  markSeen(notificationId: string): void;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h — largement au-delà des fenêtres de retry connues d'eBay.

export function createInMemoryDedupStore(ttlMs = DEFAULT_TTL_MS): NotificationDedupStore {
  const seenAt = new Map<string, number>();

  function purgeExpired(now: number): void {
    for (const [id, ts] of seenAt) {
      if (now - ts > ttlMs) seenAt.delete(id);
    }
  }

  return {
    hasSeen(notificationId: string): boolean {
      purgeExpired(Date.now());
      return seenAt.has(notificationId);
    },
    markSeen(notificationId: string): void {
      seenAt.set(notificationId, Date.now());
    },
  };
}

// Instance partagée au niveau du module — persiste tant que le processus
// Node reste chaud (garantie partielle uniquement, voir limite ci-dessus).
export const notificationDedupStore = createInMemoryDedupStore();
