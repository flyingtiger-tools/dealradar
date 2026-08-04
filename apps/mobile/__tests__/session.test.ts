const mockGetSession = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockSignOut = jest.fn();
const mockOnAuthStateChange = jest.fn();

jest.mock("../src/lib/supabase-client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  },
}));

import { getCurrentSession, getCurrentAccessToken, getCurrentUserId, signInWithPassword, signOut, onSessionChange } from "../src/auth/session";

const fakeSession = {
  access_token: "fake-access-token",
  refresh_token: "fake-refresh-token",
  user: { id: "11111111-1111-1111-1111-111111111111" },
} as never;

describe("auth/session — fine couche testable autour de supabase.auth", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSignInWithPassword.mockReset();
    mockSignOut.mockReset();
    mockOnAuthStateChange.mockReset();
  });

  it("getCurrentSession retourne la session courante du SDK, jamais une valeur inventée", async () => {
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
    expect(await getCurrentSession()).toBe(fakeSession);
  });

  it("getCurrentSession retourne null quand aucune session n'est active", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await getCurrentSession()).toBeNull();
  });

  it("getCurrentAccessToken extrait le jeton de la session, jamais saisi manuellement", async () => {
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
    expect(await getCurrentAccessToken()).toBe("fake-access-token");
  });

  it("getCurrentAccessToken retourne null sans session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await getCurrentAccessToken()).toBeNull();
  });

  it("getCurrentUserId extrait l'identifiant utilisateur directement de la session (jamais décodé manuellement d'un JWT)", async () => {
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
    expect(await getCurrentUserId()).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("signInWithPassword délègue au SDK et ne retourne aucune erreur en cas de succès", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    const result = await signInWithPassword("user@example.com", "correct-password");
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: "user@example.com", password: "correct-password" });
    expect(result.error).toBeNull();
  });

  it("signInWithPassword propage un message d'erreur lisible, jamais un crash", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const result = await signInWithPassword("user@example.com", "wrong-password");
    expect(result.error).toBe("Invalid login credentials");
  });

  it("signOut délègue au SDK", async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await signOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("onSessionChange s'abonne au SDK et retourne une fonction de désabonnement", () => {
    const unsubscribe = jest.fn();
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      cb("SIGNED_IN", fakeSession);
      return { data: { subscription: { unsubscribe } } };
    });

    const callback = jest.fn();
    const unsub = onSessionChange(callback);

    expect(callback).toHaveBeenCalledWith(fakeSession);
    unsub();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
