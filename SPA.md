# External SPA Integration (Vue + Composables)

This document describes how to implement and hand over an external Vue SPA (same host, different subdomain) that authenticates against this Laravel app and manages user resources (maps, collections).

## Target architecture

- **API app (this repository):** `https://api.example.com`
- **External SPA app:** `https://maps.example.com`
- **Auth model:** Laravel Sanctum **stateful cookie/session** auth (not bearer tokens for browser SPA)
- **Session scope:** shared parent domain (for example `.example.com`)

> [!IMPORTANT]
> Backend deployment must set: `SANCTUM_STATEFUL_DOMAINS`, `SESSION_DOMAIN`, `SESSION_SECURE_COOKIE`, `CORS_ALLOWED_ORIGINS`, and `AUTH_FRONTEND_REDIRECT_ORIGINS`.

## Backend endpoints used by SPA

### Auth endpoints

| Method | Endpoint               | Purpose                                                                                           |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------- |
| `GET`  | `/sanctum/csrf-cookie` | Initializes CSRF cookie before credentialed POST/PUT/PATCH/DELETE                                 |
| `POST` | `/api/auth/magic-link` | Requests magic-link email (always generic response)                                               |
| `GET`  | `/api/auth/session`    | Returns authenticated user (`username`, `created_at`)                                             |
| `POST` | `/api/auth/logout`     | Logs out session                                                                                  |
| `GET`  | `/auth/verify/{user}`  | Magic-link verification target; creates session and redirects to `intended` URL when allow-listed |

### Resource endpoints

| Method      | Endpoint                             | Purpose                              |
| ----------- | ------------------------------------ | ------------------------------------ |
| `GET`       | `/api/user/maps`                     | List current user's maps             |
| `POST`      | `/api/user/maps`                     | Create map                           |
| `GET`       | `/api/user/maps/{map}`               | Fetch map details                    |
| `PUT/PATCH` | `/api/user/maps/{map}`               | Update map                           |
| `DELETE`    | `/api/user/maps/{map}`               | Delete map                           |
| `GET`       | `/api/user/collections`              | List current user's root collections |
| `POST`      | `/api/user/collections`              | Create collection                    |
| `GET`       | `/api/user/collections/{collection}` | Fetch collection                     |
| `PUT/PATCH` | `/api/user/collections/{collection}` | Update collection                    |
| `DELETE`    | `/api/user/collections/{collection}` | Delete collection                    |

## Recommended SPA module structure

```text
src/
  api/
    client.ts
  composables/
    auth/
      useAuthSession.ts
      useMagicLinkAuth.ts
    resources/
      useMapsApi.ts
      useCollectionsApi.ts
      useResourceSync.ts
  stores/
    authStore.ts
    syncStore.ts
  views/
    auth/LoginView.vue
    auth/CallbackView.vue
    maps/MapListView.vue
    maps/MapEditorView.vue
```

## API client setup (required)

Use one shared Axios instance configured for cookie-based auth.

```ts
// src/api/client.ts
import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL, // https://api.example.com
  withCredentials: true,
  headers: {
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
  },
});

let csrfReady = false;

export async function ensureCsrfCookie(): Promise<void> {
  if (csrfReady) {
    return;
  }

  await api.get("/sanctum/csrf-cookie");
  csrfReady = true;
}
```

## Auth composables

### `useMagicLinkAuth`

Responsibilities:

1. Ensure CSRF cookie.
2. Request magic link with optional callback URL.
3. Keep API response generic in UI ("Check your email").

```ts
// src/composables/auth/useMagicLinkAuth.ts
import { ref } from "vue";
import { api, ensureCsrfCookie } from "@/api/client";

export function useMagicLinkAuth() {
  const submitting = ref(false);
  const message = ref<string | null>(null);
  const error = ref<string | null>(null);

  async function requestMagicLink(email: string, callbackUrl: string) {
    submitting.value = true;
    error.value = null;

    try {
      await ensureCsrfCookie();
      await api.post("/api/auth/magic-link", {
        email,
        intended: callbackUrl, // must be allow-listed by AUTH_FRONTEND_REDIRECT_ORIGINS
      });
      message.value = "Magic link sent! Check your email.";
    } catch (e) {
      error.value = "Unable to request login link.";
    } finally {
      submitting.value = false;
    }
  }

  return { submitting, message, error, requestMagicLink };
}
```

### `useAuthSession`

Responsibilities:

1. Load authenticated session (`/api/auth/session`).
2. Expose `isAuthenticated`.
3. Logout safely.

```ts
// src/composables/auth/useAuthSession.ts
import { computed, ref } from "vue";
import { api, ensureCsrfCookie } from "@/api/client";

export function useAuthSession() {
  const user = ref<{ username: string; created_at: string } | null>(null);
  const loading = ref(false);

  const isAuthenticated = computed(() => !!user.value);

  async function fetchSession() {
    loading.value = true;
    try {
      const { data } = await api.get("/api/auth/session");
      user.value = data;
    } catch {
      user.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function logout() {
    await ensureCsrfCookie();
    await api.post("/api/auth/logout");
    user.value = null;
  }

  return { user, loading, isAuthenticated, fetchSession, logout };
}
```

## Auth flow in router/views

### Login screen

1. Collect email.
2. Build callback URL from SPA origin (for example `https://maps.example.com/auth/callback`).
3. Call `requestMagicLink(email, callbackUrl)`.

### Callback screen

1. User arrives after `/auth/verify/{user}` redirect.
2. Call `fetchSession()`.
3. If authenticated, route to dashboard/sync screen.

> [!NOTE]
> Do not parse or store auth tokens in SPA. Session is cookie-based and server-managed.

## Resource composables

### `useMapsApi`

```ts
import { api, ensureCsrfCookie } from "@/api/client";

export function useMapsApi() {
  const list = () => api.get("/api/user/maps");
  const show = (id: string) => api.get(`/api/user/maps/${id}`);

  const create = async (payload: {
    title: string;
    slug: string;
    description?: string | null;
    visibility: "public" | "private";
    geojson: unknown;
    collections?: string[];
  }) => {
    await ensureCsrfCookie();
    return api.post("/api/user/maps", {
      ...payload,
      geojson: JSON.stringify(payload.geojson), // backend expects JSON string
    });
  };

  const update = async (
    id: string,
    payload: {
      title: string;
      slug: string;
      description?: string | null;
      visibility: "public" | "private";
      geojson: unknown;
      collections?: string[];
    },
  ) => {
    await ensureCsrfCookie();
    return api.put(`/api/user/maps/${id}`, {
      ...payload,
      geojson: JSON.stringify(payload.geojson),
    });
  };

  const destroy = async (id: string) => {
    await ensureCsrfCookie();
    return api.delete(`/api/user/maps/${id}`);
  };

  return { list, show, create, update, destroy };
}
```

### `useCollectionsApi`

- Same pattern as maps.
- Send `parent_id` as `null` or valid collection id.
- `slug` must be unique (server validation).

## Response handling notes

1. **List maps** (`GET /api/user/maps`) does not include full `geojson` by default. Fetch `show` for editor details.
2. **Create/update map** expects `geojson` as a JSON string (`required|json` validation rule).
3. **Session user payload** intentionally excludes user id/email. Use `username` as identifier.
4. **Unauthorized resource access** may resolve to `404` in production by design.

## Validation and error handling contract

| Status | Meaning                                | SPA behavior                                         |
| ------ | -------------------------------------- | ---------------------------------------------------- |
| `401`  | Not authenticated                      | Clear local auth state, route to login               |
| `404`  | Not found or hidden forbidden resource | Show not-found UX, do not leak existence assumptions |
| `422`  | Validation errors                      | Display field errors from response                   |
| `429`  | Magic-link rate limit                  | Show retry-after UX message                          |
| `419`  | CSRF/session issue                     | Re-run `ensureCsrfCookie()`, retry once              |

## Sync strategy recommendation (`useResourceSync`)

For map syncing between external SPA and backend:

1. Keep a local queue of pending operations (`create`, `update`, `delete`) keyed by resource id.
2. Persist queue in IndexedDB/local storage.
3. Process queue sequentially while authenticated.
4. On `401`, stop queue and require re-auth.
5. On `422`, mark item as failed and surface validation details.
6. On network failure, keep item pending and retry with backoff.

## Handover checklist

1. Confirm backend env vars are set for both subdomains.
2. Verify browser sends cookies for API domain with `withCredentials=true`.
3. Verify `/api/auth/session` succeeds after magic-link callback.
4. Verify map CRUD works end-to-end from external SPA.
5. Verify unauthorized requests are handled without exposing sensitive details.
6. Verify logout clears authenticated SPA state and blocks subsequent protected requests.
