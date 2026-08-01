"use client";

import { useEffect, useState } from "react";

/**
 * Vrai à partir du frame suivant le montage — pilote une transition
 * d'entrée en CSS (opacity/scale) sans dépendre de `@starting-style`.
 * Se redéclenche à chaque changement d'une valeur de `deps` (ex. un état
 * qui vient de basculer), pour rejouer l'entrée sur un nouveau contenu.
 */
export function useMountTransition(deps: unknown[] = []): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(false);
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return mounted;
}
