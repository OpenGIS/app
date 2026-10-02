import axios from "axios";

const CSRF_COOKIE_ENDPOINT = "/sanctum/csrf-cookie";
const TEST_MODE = import.meta.env.MODE === "test";

const envBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").trim();
const runtimeBaseUrl = (
  typeof window !== "undefined" &&
  typeof window.__OGIS_API_BASE_URL__ === "string"
    ? window.__OGIS_API_BASE_URL__
    : ""
).trim();

const apiBaseUrl = envBaseUrl || runtimeBaseUrl;

if (!apiBaseUrl && !TEST_MODE) {
  throw new Error(
    "Missing API base URL. Set VITE_API_BASE_URL (or window.__OGIS_API_BASE_URL__) to your backend origin, e.g. https://api.example.com.",
  );
}

export const api = axios.create({
  baseURL: apiBaseUrl || "",
  withCredentials: true,
  withXSRFToken: true,
  xsrfCookieName: "XSRF-TOKEN",
  xsrfHeaderName: "X-XSRF-TOKEN",
  headers: {
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
  },
});

let csrfReady = false;
let csrfPromise = null;

const toPathname = (url = "") => {
  if (!url) return "";
  try {
    return new URL(url, "https://ogis.local").pathname;
  } catch {
    return url;
  }
};

export async function ensureCsrfCookie(options = {}) {
  const { force = false } = options;

  if (force) {
    csrfReady = false;
  }

  if (csrfReady) {
    return;
  }

  if (!csrfPromise) {
    csrfPromise = api
      .get(CSRF_COOKIE_ENDPOINT)
      .then(() => {
        csrfReady = true;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }

  await csrfPromise;
}

export function resetCsrfCookieState() {
  csrfReady = false;
  csrfPromise = null;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const requestConfig = error?.config;
    const path = toPathname(requestConfig?.url);

    if (
      status !== 419 ||
      !requestConfig ||
      requestConfig.__ogisCsrfRetried ||
      path === CSRF_COOKIE_ENDPOINT
    ) {
      throw error;
    }

    requestConfig.__ogisCsrfRetried = true;
    await ensureCsrfCookie({ force: true });
    return api.request(requestConfig);
  },
);
