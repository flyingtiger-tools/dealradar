import { describe, expect, it, vi } from "vitest";
import { createOpenRouterProvider } from "../openrouter";

function chatCompletionResponse(content: string, usage = { prompt_tokens: 100, completion_tokens: 50 }): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });
}

describe("createOpenRouterProvider", () => {
  it("appelle l'URL OpenRouter avec le bon modèle et le bon système", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe("anthropic/claude-haiku-4.5");
      expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
      expect(body.response_format).toEqual({ type: "json_object" });
      return chatCompletionResponse(JSON.stringify({ cardName: "Pikachu" }));
    });
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "anthropic/claude-haiku-4.5", fetchImpl });

    const result = await provider.extract({ system: "sys", userText: "user", images: [] });

    expect(result.raw).toEqual({ cardName: "Pikachu" });
    expect(provider.name).toBe("openrouter");
    expect(provider.model).toBe("anthropic/claude-haiku-4.5");
  });

  it("place le texte utilisateur dans le message user", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.messages[1].content[0]).toEqual({ type: "text", text: "user text" });
      return chatCompletionResponse("{}");
    });
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl });
    await provider.extract({ system: "sys", userText: "user text", images: [] });
  });

  it("inclut les images en image_url dans le message utilisateur", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.messages[1].content).toEqual([
        { type: "text", text: "user" },
        { type: "image_url", image_url: { url: "https://storage.example.test/a.jpg" } },
      ]);
      return chatCompletionResponse("{}");
    });
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl });
    await provider.extract({ system: "sys", userText: "user", images: [{ url: "https://storage.example.test/a.jpg" }] });
  });

  it("retourne l'usage input/output tel que remonté par l'API", async () => {
    const fetchImpl = vi.fn(async () => chatCompletionResponse("{}", { prompt_tokens: 321, completion_tokens: 45 }));
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl });
    const result = await provider.extract({ system: "sys", userText: "user", images: [] });
    expect(result.usage).toEqual({ inputUnits: 321, outputUnits: 45 });
  });

  it("usage absent de la réponse : retombe sur 0/0, jamais une valeur inventée", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }));
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl });
    const result = await provider.extract({ system: "sys", userText: "user", images: [] });
    expect(result.usage).toEqual({ inputUnits: 0, outputUnits: 0 });
  });

  it("aucun en-tête HTTP-Referer/X-Title si non configuré — jamais de valeur inventée", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init!.headers as Record<string, string>;
      expect(headers["HTTP-Referer"]).toBeUndefined();
      expect(headers["X-Title"]).toBeUndefined();
      return chatCompletionResponse("{}");
    });
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl });
    await provider.extract({ system: "sys", userText: "user", images: [] });
  });

  it("en-têtes HTTP-Referer/X-Title inclus uniquement s'ils sont explicitement configurés", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init!.headers as Record<string, string>;
      expect(headers["HTTP-Referer"]).toBe("https://example.test");
      expect(headers["X-Title"]).toBe("Test App");
      return chatCompletionResponse("{}");
    });
    const provider = createOpenRouterProvider({
      apiKey: "or-test",
      model: "openai/gpt-4o-mini",
      fetchImpl,
      httpReferer: "https://example.test",
      appTitle: "Test App",
    });
    await provider.extract({ system: "sys", userText: "user", images: [] });
  });

  it("JSON malformé : lève une ProviderError INVALID_RESPONSE", async () => {
    const fetchImpl = vi.fn(async () => chatCompletionResponse("not-json{{{"));
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("content absent de la réponse : lève une ProviderError INVALID_RESPONSE", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }));
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("choices absent de la réponse : lève une ProviderError INVALID_RESPONSE", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("429 : retente puis lève RATE_LIMIT après épuisement des tentatives", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }));
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl, maxRetries: 1 });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "RATE_LIMIT",
      httpStatus: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("500 : retente puis lève RATE_LIMIT après épuisement des tentatives", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "internal" }), { status: 500 }));
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl, maxRetries: 1 });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "RATE_LIMIT",
      httpStatus: 500,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("401 : lève une ProviderError UNAUTHORIZED, jamais de retry", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid api key" }), { status: 401 }));
    const provider = createOpenRouterProvider({ apiKey: "or-bad", model: "openai/gpt-4o-mini", fetchImpl, maxRetries: 2 });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      httpStatus: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("timeout : lève une ProviderError TIMEOUT après épuisement des tentatives", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    });
    const provider = createOpenRouterProvider({ apiKey: "or-test", model: "openai/gpt-4o-mini", fetchImpl, timeoutMs: 5, maxRetries: 0 });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("ne journalise jamais la clé API : le header Authorization porte la vraie valeur mais n'apparaît jamais dans le résultat", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init!.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer or-real-secret");
      return chatCompletionResponse("{}");
    });
    const provider = createOpenRouterProvider({ apiKey: "or-real-secret", model: "openai/gpt-4o-mini", fetchImpl });
    const result = await provider.extract({ system: "sys", userText: "user", images: [] });
    expect(JSON.stringify(result)).not.toContain("or-real-secret");
  });
});
