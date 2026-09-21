import { describe, expect, it, vi } from "vitest";
import { createBoundedAbortController } from "../http-abort";

describe("createBoundedAbortController", () => {
  it("sans signal externe : se comporte exactement comme le timeout seul (rétrocompatible)", () => {
    vi.useFakeTimers();
    const bounded = createBoundedAbortController(1000);
    expect(bounded.controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(bounded.controller.signal.aborted).toBe(true);
    expect(bounded.outcome()).toBe("timeout");
    bounded.cleanup();
    vi.useRealTimers();
  });

  it("signal externe déclenché avant le timeout : abandon classé 'external_signal', jamais 'timeout'", () => {
    vi.useFakeTimers();
    const externalController = new AbortController();
    const bounded = createBoundedAbortController(10_000, externalController.signal);
    externalController.abort();
    expect(bounded.controller.signal.aborted).toBe(true);
    expect(bounded.outcome()).toBe("external_signal");
    bounded.cleanup();
    vi.useRealTimers();
  });

  it("signal externe déjà abandonné AVANT l'appel : abandonne immédiatement", () => {
    const externalController = new AbortController();
    externalController.abort();
    const bounded = createBoundedAbortController(10_000, externalController.signal);
    expect(bounded.controller.signal.aborted).toBe(true);
    expect(bounded.outcome()).toBe("external_signal");
    bounded.cleanup();
  });

  it("cleanup() retire le listener externe — un abandon externe APRÈS cleanup n'affecte plus rien", () => {
    const externalController = new AbortController();
    const bounded = createBoundedAbortController(10_000, externalController.signal);
    bounded.cleanup();
    externalController.abort();
    expect(bounded.outcome()).toBe(null);
  });

  it("aucun abandon : outcome() reste null", () => {
    const bounded = createBoundedAbortController(10_000);
    expect(bounded.outcome()).toBeNull();
    bounded.cleanup();
  });
});
