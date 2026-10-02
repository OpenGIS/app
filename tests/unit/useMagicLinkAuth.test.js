import { beforeEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn();
const ensureCsrfCookieMock = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    post: postMock,
  },
  ensureCsrfCookie: ensureCsrfCookieMock,
}));

describe("useMagicLinkAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    postMock.mockReset();
    ensureCsrfCookieMock.mockReset();
  });

  it("requests a magic link after ensuring csrf cookie", async () => {
    const { useMagicLinkAuth } =
      await import("@/composables/auth/useMagicLinkAuth");
    const auth = useMagicLinkAuth("magic-link-success");

    ensureCsrfCookieMock.mockResolvedValue(undefined);
    postMock.mockResolvedValue({});

    const result = await auth.requestMagicLink(
      " user@example.com ",
      "https://maps.example.com/auth/callback",
    );

    expect(result).toEqual({ ok: true, status: 200 });
    expect(ensureCsrfCookieMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith("/api/auth/magic-link", {
      email: "user@example.com",
      intended: "https://maps.example.com/auth/callback",
    });
    expect(auth.message.value).toBe("Magic link sent! Check your email.");
  });

  it("returns a validation error when email is missing", async () => {
    const { useMagicLinkAuth } =
      await import("@/composables/auth/useMagicLinkAuth");
    const auth = useMagicLinkAuth("magic-link-empty-email");

    const result = await auth.requestMagicLink(
      "   ",
      "https://maps.example.com/auth/callback",
    );

    expect(result).toEqual({ ok: false, status: 422 });
    expect(postMock).not.toHaveBeenCalled();
    expect(auth.error.value).toBe("Email is required.");
  });

  it("captures retry-after information on 429 responses", async () => {
    const { useMagicLinkAuth } =
      await import("@/composables/auth/useMagicLinkAuth");
    const auth = useMagicLinkAuth("magic-link-rate-limit");

    ensureCsrfCookieMock.mockResolvedValue(undefined);
    postMock.mockRejectedValue({
      response: {
        status: 429,
        headers: { "retry-after": "45" },
      },
    });

    const result = await auth.requestMagicLink(
      "user@example.com",
      "https://maps.example.com/auth/callback",
    );

    expect(result).toEqual({ ok: false, status: 429 });
    expect(auth.error.value).toBe(
      "Too many attempts. Please try again shortly.",
    );
    expect(auth.retryAfter.value).toBe(45);
  });

  it("surfaces first validation message from 422 errors", async () => {
    const { useMagicLinkAuth } =
      await import("@/composables/auth/useMagicLinkAuth");
    const auth = useMagicLinkAuth("magic-link-422");

    ensureCsrfCookieMock.mockResolvedValue(undefined);
    postMock.mockRejectedValue({
      response: {
        status: 422,
        data: {
          errors: {
            email: ["The email field must be a valid email address."],
          },
        },
      },
    });

    const result = await auth.requestMagicLink(
      "invalid",
      "https://maps.example.com/auth/callback",
    );

    expect(result).toEqual({ ok: false, status: 422 });
    expect(auth.error.value).toBe(
      "The email field must be a valid email address.",
    );
  });
});
