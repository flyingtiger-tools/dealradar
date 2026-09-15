jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isOnboardingCompleted, resetOnboarding, setOnboardingCompleted } from "../onboarding-storage";

describe("onboarding-storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("jamais vu : false par défaut", async () => {
    expect(await isOnboardingCompleted()).toBe(false);
  });

  it("setOnboardingCompleted(true) puis relecture : true", async () => {
    await setOnboardingCompleted(true);
    expect(await isOnboardingCompleted()).toBe(true);
  });

  it("resetOnboarding() : repasse à false, utile pour Internal Tools (Phase 31)", async () => {
    await setOnboardingCompleted(true);
    await resetOnboarding();
    expect(await isOnboardingCompleted()).toBe(false);
  });

  it("stockage indisponible (AsyncStorage.getItem rejette) : jamais un throw, replie sur false", async () => {
    const spy = jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("stockage indisponible"));
    await expect(isOnboardingCompleted()).resolves.toBe(false);
    spy.mockRestore();
  });
});
