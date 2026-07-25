import type { Metadata } from "next";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Verdict } from "@/components/ui/verdict";

export const metadata: Metadata = { title: "Tableau de bord" };

/**
 * Tableau de bord — données de démonstration en attendant le Lot 3
 * (pipeline d'ingestion). La structure et les composants sont définitifs.
 */
const demoOpportunities = [
  { title: "Vélo cargo Babboe City — révisé 2025", price: "890 CHF", market: "méd. 1 240 CHF", score: 84, verdict: "buy" },
  { title: "MacBook Air M2 16 Go", price: "780 CHF", market: "méd. 850 CHF", score: 62, verdict: "wait" },
  { title: "Poussette Bugaboo Fox 3", price: "540 CHF", market: "méd. 520 CHF", score: 41, verdict: "wait" },
  { title: "Table Tulip Knoll authentique", price: "2 900 CHF", market: "méd. 2 150 CHF", score: 22, verdict: "sell" },
] as const;

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Tableau de bord</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card><CardBody><Stat label="Opportunités actives" value="12" trend={{ direction: "up", text: "3 aujourd'hui" }} /></CardBody></Card>
        <Card><CardBody><Stat label="Alertes armées" value="5" /></CardBody></Card>
        <Card><CardBody><Stat label="Valeur du portfolio" value="4 320 CHF" trend={{ direction: "up", text: "+6,2 % / 30 j" }} /></CardBody></Card>
        <Card><CardBody><Stat label="Économies réalisées" value="1 180 CHF" /></CardBody></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Signaux du jour</CardTitle>
          <span className="font-data text-xs text-muted">démo — pipeline au Lot 3</span>
        </CardHeader>
        <CardBody className="p-0 pt-3">
          <ul className="divide-y divide-line">
            {demoOpportunities.map((o) => (
              <li key={o.title} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{o.title}</p>
                  <p className="font-data text-xs text-muted tabular-nums">
                    {o.price} · {o.market}
                  </p>
                </div>
                <span className="font-data text-sm tabular-nums text-muted">{o.score}</span>
                <Verdict value={o.verdict} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
