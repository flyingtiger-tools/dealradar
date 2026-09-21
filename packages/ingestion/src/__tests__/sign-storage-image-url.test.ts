import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signStorageImageUrl } from "../sign-storage-image-url";

function fakeDb(opts: { createSignedUrl: ReturnType<typeof vi.fn> }): SupabaseClient {
  return {
    storage: {
      from: (bucket: string) => ({
        bucket,
        createSignedUrl: opts.createSignedUrl,
      }),
    },
  } as unknown as SupabaseClient;
}

describe("signStorageImageUrl", () => {
  it("signe une URL du bucket analysis-uploads et retourne l'URL signée", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/x?token=abc" }, error: null });
    const db = fakeDb({ createSignedUrl });

    const result = await signStorageImageUrl(db, "https://project.supabase.co/storage/v1/object/analysis-uploads/user-1/req-1/photo.jpg");

    expect(result).toBe("https://signed.example/x?token=abc");
    expect(createSignedUrl).toHaveBeenCalledWith("user-1/req-1/photo.jpg", 300);
  });

  it("retire les paramètres de requête éventuels du chemin avant de signer", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
    const db = fakeDb({ createSignedUrl });

    await signStorageImageUrl(db, "https://project.supabase.co/storage/v1/object/analysis-uploads/user-1/req-1/photo.jpg?extra=1");

    expect(createSignedUrl).toHaveBeenCalledWith("user-1/req-1/photo.jpg", 300);
  });

  it("URL qui ne pointe pas vers analysis-uploads : null, jamais une signature tentée sur une source externe", async () => {
    const createSignedUrl = vi.fn();
    const db = fakeDb({ createSignedUrl });

    const result = await signStorageImageUrl(db, "https://example.com/some/other/image.jpg");

    expect(result).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("échec de signature (erreur Supabase) : null, jamais une exception qui remonte", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
    const db = fakeDb({ createSignedUrl });

    const result = await signStorageImageUrl(db, "https://project.supabase.co/storage/v1/object/analysis-uploads/user-1/req-1/photo.jpg");

    expect(result).toBeNull();
  });

  it("réponse sans signedUrl exploitable : null, jamais une chaîne vide/undefined propagée", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: {}, error: null });
    const db = fakeDb({ createSignedUrl });

    const result = await signStorageImageUrl(db, "https://project.supabase.co/storage/v1/object/analysis-uploads/user-1/req-1/photo.jpg");

    expect(result).toBeNull();
  });
});
