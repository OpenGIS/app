import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const postMock = vi.fn();
const ensureCsrfCookieMock = vi.fn();
const resetCsrfCookieStateMock = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    get: getMock,
    post: postMock,
  },
  ensureCsrfCookie: ensureCsrfCookieMock,
  resetCsrfCookieState: resetCsrfCookieStateMock,
}));

describe("useAuthSession", () => {
  beforeEach(() => {
    vi.resetModules();
    getMock.mockReset();
    postMock.mockReset();
    ensureCsrfCookieMock.mockReset();
    resetCsrfCookieStateMock.mockReset();
  });

  it("loads and stores the authenticated user from /api/auth/session", async () => {
    const { useAuthSession } =
      await import("@/composables/auth/useAuthSession");
    const auth = useAuthSession("auth-session-success");

    getMock.mockResolvedValue({
      data: { username: "jdoe", created_at: "2026-04-10T12:00:00Z" },
    });

    const result = await auth.fetchSession();

    expect(getMock).toHaveBeenCalledWith("/api/auth/session");
    expect(result).toEqual({
      username: "jdoe",
      created_at: "2026-04-10T12:00:00Z",
    });
    expect(auth.user.value?.username).toBe("jdoe");
    expect(auth.isAuthenticated.value).toBe(true);
  });

  it("treats 401 as unauthenticated and clears local user state", async () => {
    const { useAuthSession } =
      await import("@/composables/auth/useAuthSession");
    const auth = useAuthSession("auth-session-401");

    auth.user.value = {
      username: "existing-user",
      created_at: "2026-01-01T00:00:00Z",
    };
    getMock.mockRejectedValue({ response: { status: 401 } });

    const result = await auth.fetchSession();

    expect(result).toBeNull();
    expect(auth.user.value).toBeNull();
    expect(auth.isAuthenticated.value).toBe(false);
  });

  it("throws non-401 session errors to allow explicit UI handling", async () => {
    const { useAuthSession } =
      await import("@/composables/auth/useAuthSession");
    const auth = useAuthSession("auth-session-500");
    const error = { response: { status: 500 } };
    getMock.mockRejectedValue(error);

    await expect(auth.fetchSession()).rejects.toBe(error);
    expect(auth.error.value).toBe("Unable to load your account session.");
  });

  it("logs out with CSRF protection and clears local session state", async () => {
    const { useAuthSession } =
      await import("@/composables/auth/useAuthSession");
    const auth = useAuthSession("auth-session-logout");

    ensureCsrfCookieMock.mockResolvedValue(undefined);
    postMock.mockResolvedValue({});
    auth.user.value = { username: "jdoe", created_at: "2026-04-10T12:00:00Z" };

    await auth.logout();

    expect(ensureCsrfCookieMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith("/api/auth/logout");
    expect(auth.user.value).toBeNull();
    expect(resetCsrfCookieStateMock).toHaveBeenCalledTimes(1);
  });
});
