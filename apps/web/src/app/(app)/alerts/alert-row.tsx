"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Alert } from "@dealradar/core";
import { updateAlertInputSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { ALERT_KIND_LABELS } from "@/lib/labels";
import { Button } from "@/components/ui/button";

type AlertRowData = Alert & { savedSearchName: string | null; listingTitle: string | null };

export function AlertRow({ alert }: { alert: AlertRowData }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggleActive() {
    const parsed = updateAlertInputSchema.parse({ isActive: !alert.isActive });
    setPending(true);
    const supabase = createClient();
    await supabase.from("alerts").update({ is_active: parsed.isActive }).eq("id", alert.id);
    setPending(false);
    router.refresh();
  }

  async function handleDelete() {
    setPending(true);
    const supabase = createClient();
    await supabase.from("alerts").delete().eq("id", alert.id);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{ALERT_KIND_LABELS[alert.kind]}</p>
        <p className="font-data text-xs text-muted tabular-nums">
          {alert.savedSearchName ?? alert.listingTitle ?? "—"}
          {alert.params.thresholdCents != null
            ? ` · seuil ${(alert.params.thresholdCents / 100).toFixed(0)} CHF`
            : ""}
          {" · "}
          {alert.lastFiredAt ? `déclenchée ${formatDate(alert.lastFiredAt)}` : "jamais déclenchée"}
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={toggleActive} disabled={pending}>
        {alert.isActive ? "Désactiver" : "Activer"}
      </Button>
      <Button variant="danger" size="sm" onClick={handleDelete} disabled={pending}>
        Supprimer
      </Button>
    </div>
  );
}
