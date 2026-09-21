/**
 * Combinaison d'un timeout BORNÉ interne (toujours présent, jamais retiré)
 * avec un `AbortSignal` EXTERNE optionnel fourni par l'appelant (LOT "Data
 * Quality Calibration + Operator Observability + Mobile Market Insight
 * Contract", section 7) — permet au run de rafraîchissement d'arrêter
 * COOPÉRATIVEMENT un appel en cours quand son délai global expire, sans
 * jamais retirer le filet de sécurité du timeout par-appel existant.
 *
 * Rétrocompatible : un appelant qui ne fournit aucun signal externe obtient
 * exactement le comportement précédent (timeout seul).
 */
export type AbortOutcome = "timeout" | "external_signal" | null;

export interface BoundedAbort {
  controller: AbortController;
  /** À appeler dans un `finally` — nettoie le timer ET le listener, jamais une fuite. */
  cleanup: () => void;
  /** Raison de l'abandon SI le controller a été abandonné — `null` si l'appel s'est terminé normalement. */
  outcome: () => AbortOutcome;
}

export function createBoundedAbortController(timeoutMs: number, externalSignal?: AbortSignal): BoundedAbort {
  const controller = new AbortController();
  let reason: AbortOutcome = null;

  const timeoutHandle = setTimeout(() => {
    reason = "timeout";
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => {
    reason = "external_signal";
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  return {
    controller,
    cleanup: () => {
      clearTimeout(timeoutHandle);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
    outcome: () => reason,
  };
}
