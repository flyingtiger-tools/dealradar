import { describe, expect, it } from "vitest";
import { createSimulatedProvider } from "../simulated";

describe("createSimulatedProvider", () => {
  it("ne fabrique jamais de valeur d'extraction — retourne un JSON vide", async () => {
    const provider = createSimulatedProvider({ latencyMs: 5 });
    const response = await provider.extract({ system: "sys", userText: "titre annonce", images: [] });
    expect(response.raw).toEqual({});
  });

  it("s'identifie comme provider simulé, jamais confondu avec un vrai provider", async () => {
    const provider = createSimulatedProvider();
    expect(provider.name).toBe("simulated");
  });

  it("respecte la latence artificielle configurée", async () => {
    const provider = createSimulatedProvider({ latencyMs: 30 });
    const start = performance.now();
    await provider.extract({ system: "sys", userText: "x", images: [] });
    expect(performance.now() - start).toBeGreaterThanOrEqual(25);
  });
});
