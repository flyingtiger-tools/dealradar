import { checkBackendReachable, extractDomain } from "../backend-health";

describe("extractDomain", () => {
  it("extrait le nom d'hôte seul, jamais le chemin/la query", () => {
    expect(extractDomain("https://dealradar.example.com/api/v1/analyses?x=1")).toBe("dealradar.example.com");
  });

  it("URL invalide : repli sur la chaîne d'origine, jamais un throw", () => {
    expect(extractDomain("pas-une-url")).toBe("pas-une-url");
  });
});

describe("checkBackendReachable", () => {
  it("réponse < 500 : reachable", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 200 }) as unknown as typeof fetch;
    expect(await checkBackendReachable()).toBe(true);
  });

  it("réponse 503 : not reachable", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 503 }) as unknown as typeof fetch;
    expect(await checkBackendReachable()).toBe(false);
  });

  it("fetch rejette (réseau/DNS) : not reachable, jamais un throw", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Network request failed")) as unknown as typeof fetch;
    expect(await checkBackendReachable()).toBe(false);
  });
});
