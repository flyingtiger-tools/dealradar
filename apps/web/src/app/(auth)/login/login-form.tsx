"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OAuthButtons } from "../oauth-buttons";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("Identifiants incorrects. Vérifiez l'e-mail et le mot de passe.");
      setPending(false);
      return;
    }
    router.push(params.get("next") ?? "/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-center text-xl font-semibold">Connexion</h1>
      <div className="space-y-3">
        <Input
          type="email"
          placeholder="E-mail"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Mot de passe"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-sm text-down">{error}</p> : null}
        <Button className="w-full" onClick={handleSubmit} disabled={pending}>
          {pending ? "Connexion…" : "Se connecter"}
        </Button>
      </div>
      <OAuthButtons />
      <p className="text-center text-sm text-muted">
        Pas de compte ?{" "}
        <Link href="/register" className="text-body underline underline-offset-4">
          Créer un compte
        </Link>
      </p>
    </div>
  );
}
