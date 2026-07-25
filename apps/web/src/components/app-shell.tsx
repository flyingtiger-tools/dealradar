"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/search", label: "Recherche" },
  { href: "/alerts", label: "Alertes" },
  { href: "/watchlists", label: "Watchlists" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/history", label: "Historique" },
  { href: "/notifications", label: "Notifications" },
  { href: "/stats", label: "Statistiques" },
] as const;

const NAV_SECONDARY = [
  { href: "/settings", label: "Paramètres" },
  { href: "/account", label: "Compte" },
  { href: "/subscription", label: "Abonnement" },
] as const;

/**
 * Shell applicatif — mobile first :
 * barre inférieure sur mobile, sidebar sur desktop.
 */
export function AppShell({
  children,
  isAdmin,
}: {
  children: React.ReactNode;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    cn(
      "rounded px-3 py-2 text-sm transition-colors",
      pathname.startsWith(href)
        ? "bg-raised text-body"
        : "text-muted hover:bg-raised hover:text-body",
    );

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar desktop */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line p-4 md:flex">
        <Link href="/dashboard" className="px-3 py-2 font-data text-sm font-semibold tracking-widest">
          DEALRADAR
        </Link>
        <nav className="mt-4 flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={linkClass(item.href)}>
              {item.label}
            </Link>
          ))}
          <div className="my-3 h-px bg-line" />
          {NAV_SECONDARY.map((item) => (
            <Link key={item.href} href={item.href} className={linkClass(item.href)}>
              {item.label}
            </Link>
          ))}
          {isAdmin ? (
            <Link href="/admin" className={linkClass("/admin")}>
              Administration
            </Link>
          ) : null}
        </nav>
        <button
          onClick={signOut}
          className="rounded px-3 py-2 text-left text-sm text-muted hover:bg-raised hover:text-body"
        >
          Se déconnecter
        </button>
      </aside>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-8">
          {children}
        </main>
      </div>

      {/* Barre inférieure mobile : les 4 destinations principales */}
      <nav className="fixed inset-x-0 bottom-0 flex border-t border-line bg-surface md:hidden">
        {NAV.slice(0, 4).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex-1 py-3 text-center text-xs",
              pathname.startsWith(item.href) ? "text-body" : "text-muted",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
