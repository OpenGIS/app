import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const requestMock = vi.fn();
const useRequestInterceptorMock = vi.fn();
const useResponseInterceptorMock = vi.fn();
const createMock = vi.fn(() => ({
  get: getMock,
  request: requestMock,
  interceptors: {
    request: {
      use: useRequestInterceptorMock,
    },
    response: {
      use: useResponseInterceptorMock,
    },
  },
}));

vi.mock("axios", () => ({
  default: {
    create: createMock,
  },
}));

describe("api/client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    getMock.mockReset();
    requestMock.mockReset();
    useRequestInterceptorMock.mockReset();
    useResponseInterceptorMock.mockReset();
    createMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates an axios client configured for credentialed SPA auth", async () => {
    await import("@/api/client");

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        withCredentials: true,
        withXSRFToken: true,
        xsrfCookieName: "XSRF-TOKEN",
        xsrfHeaderName: "X-XSRF-TOKEN",
        headers: expect.objectContaining({
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json",
        }),
      }),
    );
    expect(useRequestInterceptorMock).toHaveBeenCalledTimes(1);
    expect(useRequestInterceptorMock).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it("imports without a configured base URL", async () => {
    await expect(import("@/api/client")).resolves.toHaveProperty("api");
  });

  it("enforces a missing base URL lazily outside test mode", async () => {
    vi.stubEnv("MODE", "production");

    const { requireApiBaseUrl } = await import("@/api/client");

    expect(requireApiBaseUrl).toBeTypeOf("function");
    expect(() => requireApiBaseUrl()).toThrow(/Missing API base URL/);

    const onRequest = useRequestInterceptorMock.mock.calls[0][0];
    expect(() => onRequest({ url: "/api/maps" })).toThrow(
      /Missing API base URL/,
    );
  });

  it("allows requests when a base URL is configured", async () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");

    const { requireApiBaseUrl } = await import("@/api/client");
    const config = { url: "/api/maps" };
    const onRequest = useRequestInterceptorMock.mock.calls[0][0];

    expect(requireApiBaseUrl()).toBe("https://api.example.com");
    expect(onRequest(config)).toBe(config);
  });

  it("requests /sanctum/csrf-cookie only once after initialization", async () => {
    getMock.mockResolvedValue({});
    const { ensureCsrfCookie } = await import("@/api/client");

    await ensureCsrfCookie();
    await ensureCsrfCookie();

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith("/sanctum/csrf-cookie");
  });

  it("forces a fresh CSRF request when force=true", async () => {
    getMock.mockResolvedValue({});
    const { ensureCsrfCookie } = await import("@/api/client");

    await ensureCsrfCookie();
    await ensureCsrfCookie({ force: true });

    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("retries once after a 419 response by refreshing CSRF cookie", async () => {
    getMock.mockResolvedValue({});
    requestMock.mockResolvedValue({ data: { ok: true } });
    const { api } = await import("@/api/client");

    const onRejected = useResponseInterceptorMock.mock.calls[0][1];
    const requestConfig = { method: "post", url: "/api/auth/logout" };

    const result = await onRejected({
      response: { status: 419 },
      config: requestConfig,
    });

    expect(getMock).toHaveBeenCalledWith("/sanctum/csrf-cookie");
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/auth/logout",
        __ogisCsrfRetried: true,
      }),
    );
    expect(result).toEqual({ data: { ok: true } });
    expect(api).toBeTruthy();
  });

  it("does not retry csrf endpoint requests", async () => {
    getMock.mockResolvedValue({});
    await import("@/api/client");
    const onRejected = useResponseInterceptorMock.mock.calls[0][1];
    const error = {
      response: { status: 419 },
      config: { method: "get", url: "/sanctum/csrf-cookie" },
    };

    await expect(onRejected(error)).rejects.toBe(error);
    expect(requestMock).not.toHaveBeenCalled();
  });
});
