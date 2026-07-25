"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Google et Apple, via Supabase Auth.
 * Prérequis : providers activés dans le projet Supabase (redirect: /auth/callback).
 */
export function OAuthButtons() {
  async function signInWith(provider: "google" | "apple") {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        ou
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button variant="secondary" className="w-full" onClick={() => signInWith("google")}>
        Continuer avec Google
      </Button>
      <Button variant="secondary" className="w-full" onClick={() => signInWith("apple")}>
        Continuer avec Apple
      </Button>
    </div>
  );
}
