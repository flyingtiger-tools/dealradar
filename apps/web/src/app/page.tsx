import Link from "next/link";
import { Verdict } from "@/components/ui/verdict";

/**
 * Accueil — la thèse du produit en une phrase, illustrée par
 * le composant signature : le verdict.
 */
const demoSignals = [
  { title: "Vélo cargo Babboe City", price: "890 CHF", verdict: "buy" },
  { title: "iPhone 14 Pro 256 Go", price: "620 CHF", verdict: "wait" },
  { title: "Eames Lounge Chair (réplique)", price: "1 450 CHF", verdict: "sell" },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="font-data text-sm font-semibold tracking-widest">DEALRADAR</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/login" className="text-muted hover:text-body">
            Connexion
          </Link>
          <Link
            href="/register"
            className="rounded bg-body px-3 py-1.5 font-medium text-ink hover:opacity-90"
          >
            Créer un compte
          </Link>
        </nav>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-10 py-16">
        <div className="space-y-5">
          <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
            Know When.
          </h1>
          <p className="max-w-lg text-lg text-muted">
            La seconde main est un marché. DealRadar lit ses prix, ses tendances et
            ses risques pour vous dire la seule chose qui compte&nbsp;: quand acheter,
            quand attendre, quand vendre.
          </p>
        </div>

        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {demoSignals.map((s) => (
            <li key={s.title} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm">{s.title}</p>
                <p className="font-data text-sm text-muted tabular-nums">{s.price}</p>
              </div>
              <Verdict value={s.verdict} />
            </li>
          ))}
        </ul>

        <div>
          <Link
            href="/register"
            className="inline-flex h-11 items-center rounded bg-body px-6 text-sm font-medium text-ink hover:opacity-90"
          >
            Voir le marché autrement
          </Link>
        </div>
      </section>

      <footer className="border-t border-line py-6 text-xs text-muted">
        © 2026 DealRadar — Le Bloomberg de la seconde main.
      </footer>
    </main>
  );
}
