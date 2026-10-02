import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const requestMock = vi.fn();
const useResponseInterceptorMock = vi.fn();
const createMock = vi.fn(() => ({
  get: getMock,
  request: requestMock,
  interceptors: {
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
    getMock.mockReset();
    requestMock.mockReset();
    useResponseInterceptorMock.mockReset();
    createMock.mockClear();
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
