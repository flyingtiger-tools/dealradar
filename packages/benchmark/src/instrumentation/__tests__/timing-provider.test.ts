import { describe, expect, it } from "vitest";
import { createTimingProvider } from "../timing-provider";
import { createSimulatedProvider } from "../../provider/simulated";

describe("createTimingProvider", () => {
  it("mesure la durée réelle d'un provider décoré (simulé, latence artificielle)", async () => {
    const inner = createSimulatedProvider({ latencyMs: 20 });
    const { provider, timings } = createTimingProvider(inner);

    const response = await provider.extract({ system: "sys", userText: "user", images: [] });

    expect(response.raw).toEqual({});
    expect(timings.calls).toBe(1);
    expect(timings.totalMs).toBeGreaterThanOrEqual(15);
    expect(provider.name).toBe("simulated");
  });
});
