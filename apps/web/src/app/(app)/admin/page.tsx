import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Administration" };

/** Réservé au rôle admin — vérification serveur en plus de la RLS. */
export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/dashboard");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Administration</h1>
      <Link href="/admin/ingestion" className="text-sm text-body underline underline-offset-4">
        Ingestion eBay (Lot 4) →
      </Link>
      <EmptyState
        title="Console d'administration"
        description="Gestion des sources, de la taxonomie, des utilisateurs et supervision des workers — construite au Lot 4."
      />
    </div>
  );
}
