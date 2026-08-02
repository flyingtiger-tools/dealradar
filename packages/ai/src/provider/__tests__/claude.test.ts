import { describe, expect, it, vi } from "vitest";
import { createClaudeProvider } from "../claude";

function messagesResponse(text: string, usage = { input_tokens: 1900, output_tokens: 200 }): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text }], usage }), { status: 200 });
}

describe("createClaudeProvider", () => {
  it("extraction image réussie : appelle Messages API et retourne le JSON parsé + l'usage", async () => {
    const fetchImpl = vi.fn(async () => messagesResponse(JSON.stringify({ cardName: "Pikachu" })));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });

    const result = await provider.extract({ system: "sys", userText: "user", images: [{ url: "https://storage.example.test/a.jpg" }] });

    expect(result.raw).toEqual({ cardName: "Pikachu" });
    expect(result.usage).toEqual({ inputUnits: 1900, outputUnits: 200 });
    expect(provider.name).toBe("anthropic");
    expect(provider.model).toBe("claude-haiku-4-5-20251001");
  });

  it("place le système en paramètre de premier niveau et les images avant le texte", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.system).toBe("sys");
      expect(body.messages[0].content).toEqual([
        { type: "image", source: { type: "url", url: "https://storage.example.test/a.jpg" } },
        { type: "text", text: "user" },
      ]);
      return messagesResponse("{}");
    });
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    await provider.extract({ system: "sys", userText: "user", images: [{ url: "https://storage.example.test/a.jpg" }] });
  });

  it("payload invalide : lève une ProviderError si le contenu texte n'est pas un JSON valide", async () => {
    const fetchImpl = vi.fn(async () => messagesResponse("not-json{{{"));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("réponse sans bloc texte exploitable : lève une ProviderError", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ content: [], usage: {} }), { status: 200 }));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("modèle invalide (400 de l'API) : lève une ProviderError, jamais de retry", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 400 }));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-does-not-exist", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      httpStatus: 400,
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
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl, timeoutMs: 5, maxRetries: 0 });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("429 : retente puis lève RATE_LIMIT après épuisement des tentatives", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl, maxRetries: 1 });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "RATE_LIMIT",
      httpStatus: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("500 : retente puis lève RATE_LIMIT après épuisement des tentatives", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "internal" }), { status: 500 }));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl, maxRetries: 1 });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "RATE_LIMIT",
      httpStatus: 500,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("JSON brut sans enrobage : fonctionne toujours", async () => {
    const fetchImpl = vi.fn(async () => messagesResponse(JSON.stringify({ cardName: "Dracaufeu" })));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    const result = await provider.extract({ system: "sys", userText: "user", images: [] });
    expect(result.raw).toEqual({ cardName: "Dracaufeu" });
  });

  it("bloc ```json ... ``` : l'enrobage est retiré avant le parsing", async () => {
    const fetchImpl = vi.fn(async () => messagesResponse('```json\n{"cardName":"Dracaufeu"}\n```'));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    const result = await provider.extract({ system: "sys", userText: "user", images: [] });
    expect(result.raw).toEqual({ cardName: "Dracaufeu" });
  });

  it("bloc ``` ... ``` sans tag json : l'enrobage est retiré avant le parsing", async () => {
    const fetchImpl = vi.fn(async () => messagesResponse('```\n{"cardName":"Dracaufeu"}\n```'));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    const result = await provider.extract({ system: "sys", userText: "user", images: [] });
    expect(result.raw).toEqual({ cardName: "Dracaufeu" });
  });

  it("espaces avant/après les fences : fonctionne", async () => {
    const fetchImpl = vi.fn(async () => messagesResponse('  \n```json\n{"cardName":"Dracaufeu"}\n```\n  '));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    const result = await provider.extract({ system: "sys", userText: "user", images: [] });
    expect(result.raw).toEqual({ cardName: "Dracaufeu" });
  });

  it("texte supplémentaire avant le bloc : refus INVALID_RESPONSE, jamais une extraction partielle", async () => {
    const fetchImpl = vi.fn(async () => messagesResponse('Voici le JSON :\n```json\n{"cardName":"Dracaufeu"}\n```'));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("texte supplémentaire après le bloc : refus INVALID_RESPONSE, jamais une extraction partielle", async () => {
    const fetchImpl = vi.fn(async () => messagesResponse('```json\n{"cardName":"Dracaufeu"}\n```\nMerci !'));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("JSON réellement invalide (dans ou hors bloc) : refus INVALID_RESPONSE", async () => {
    const fetchImpl = vi.fn(async () => messagesResponse('```json\n{cardName: "Dracaufeu"\n```'));
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("plusieurs blocs de code concaténés : refus INVALID_RESPONSE, jamais le premier bloc extrait arbitrairement", async () => {
    const fetchImpl = vi.fn(async () =>
      messagesResponse('```json\n{"cardName":"Dracaufeu"}\n```\n```json\n{"cardName":"Pikachu"}\n```'),
    );
    const provider = createClaudeProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5-20251001", fetchImpl });
    await expect(provider.extract({ system: "sys", userText: "user", images: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("ne journalise jamais la clé API : le header x-api-key porte la vraie valeur mais n'apparaît jamais dans le résultat", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init!.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-real-secret");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      return messagesResponse("{}");
    });
    const provider = createClaudeProvider({ apiKey: "sk-ant-real-secret", model: "claude-haiku-4-5-20251001", fetchImpl });
    const result = await provider.extract({ system: "sys", userText: "user", images: [] });
    expect(JSON.stringify(result)).not.toContain("sk-ant-real-secret");
  });
});
