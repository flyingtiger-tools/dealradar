"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OAuthButtons } from "../oauth-buttons";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError("Création impossible avec cet e-mail. Essayez de vous connecter.");
      setPending(false);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <p className="text-center text-sm text-muted">
        Un e-mail de confirmation vient d&apos;être envoyé à <span className="text-body">{email}</span>.
        Ouvrez le lien pour activer votre compte.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-center text-xl font-semibold">Créer un compte</h1>
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
          placeholder="Mot de passe (8 caractères min.)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-sm text-down">{error}</p> : null}
        <Button className="w-full" onClick={handleSubmit} disabled={pending}>
          {pending ? "Création…" : "Créer mon compte"}
        </Button>
      </div>
      <OAuthButtons />
      <p className="text-center text-sm text-muted">
        Déjà inscrit ?{" "}
        <Link href="/login" className="text-body underline underline-offset-4">
          Connexion
        </Link>
      </p>
    </div>
  );
}
