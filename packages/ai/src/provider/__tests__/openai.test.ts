import { describe, expect, it, vi } from "vitest";
import { createOpenAiProvider } from "../openai";

function chatCompletionResponse(content: string, usage = { prompt_tokens: 100, completion_tokens: 50 }): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });
}

describe("createOpenAiProvider", () => {
  it("appelle chat/completions et retourne le JSON parsé + l'usage", async () => {
    const fetchImpl = vi.fn(async () => chatCompletionResponse(JSON.stringify({ brand: "LEGO" })));
    const provider = createOpenAiProvider({ apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl });

    const result = await provider.extract({ system: "sys", userText: "user", images: [] });

    expect(result.raw).toEqual({ brand: "LEGO" });
    expect(result.usage).toEqual({ inputUnits: 100, outputUnits: 50 });
    expect(provider.name).toBe("openai");
  });

  it("inclut les images en image_url dans le message utilisateur", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.messages[1].content).toEqual([
        { type: "text", text: "user" },
        { type: "image_url", image_url: { url: "https://i.ebayimg.com/a.jpg" } },
      ]);
      return chatCompletionResponse("{}");
    });
    const provider = createOpenAiProvider({ apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl });
    await provider.extract({ system: "sys", userText: "user", images: [{ url: "https://i.ebayimg.com/a.jpg" }] });
  });

  it("lève une ProviderError si le contenu n'est pas un JSON valide", async () => {
    const fetchImpl = vi.fn(async () => chatCompletionResponse("not-json{{{"));
    const provider = createOpenAiProvider({ apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("ne journalise jamais la clé API dans les en-têtes exposés à l'appelant", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init!.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-real-secret");
      return chatCompletionResponse("{}");
    });
    const provider = createOpenAiProvider({ apiKey: "sk-real-secret", model: "gpt-4o-mini", fetchImpl });
    const result = await provider.extract({ system: "sys", userText: "user", images: [] });
    expect(JSON.stringify(result)).not.toContain("sk-real-secret");
  });
});
