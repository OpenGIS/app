// Skip: features are commented out in src/main.js:16-20,113-116 — remove the skip when the features ship.
import { expect, test } from "@playwright/test";

const withViewStorage = (page) =>
  page.addInitScript(() =>
    localStorage.setItem(
      "ogis_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 12 },
      }),
    ),
  );

test.describe.skip("Collections feature", () => {
  test("authenticated user can list collections and update selected collection metadata", async ({
    page,
  }) => {
    await withViewStorage(page);

    let collectionShowCalls = 0;
    let updatePayload = null;
    let collectionUpdated = false;

    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          username: "joe",
          created_at: "2026-04-01T10:00:00Z",
        }),
      }),
    );
    await page.route("**/sanctum/csrf-cookie", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );

    await page.route("**/api/user/collections/col-1*", async (route) => {
      const method = route.request().method();
      const requestOrigin =
        route.request().headers().origin ?? "http://127.0.0.1:4173";
      const requestHeaders =
        route.request().headers()["access-control-request-headers"] ?? "*";
      const preflightHeaders = {
        "access-control-allow-origin": requestOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,PUT,PATCH,OPTIONS",
        "access-control-allow-headers": requestHeaders,
      };

      if (method === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: preflightHeaders,
          body: "",
        });
        return;
      }

      if (method === "PUT" || method === "PATCH") {
        updatePayload = route.request().postDataJSON();
        collectionUpdated = true;

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              id: "col-1",
              title: "Updated Collection",
              slug: "updated-collection",
              description: "Updated description.",
              visibility: "public",
              parent_id: null,
              maps_count: 0,
              children_count: 0,
              maps: [],
              children: [],
            },
          }),
        });
        return;
      }

      collectionShowCalls += 1;
      const title = collectionUpdated ? "Updated Collection" : "Trips";
      const slug = collectionUpdated ? "updated-collection" : "trips";
      const description = collectionUpdated
        ? "Updated description."
        : "Original description.";
      const visibility = collectionUpdated ? "public" : "private";

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "col-1",
            title,
            slug,
            description,
            visibility,
            parent_id: null,
            maps_count: 1,
            children_count: 0,
            maps: [
              {
                id: "map-1",
                title: "Morning Route",
                slug: "morning-route",
                visibility: "private",
              },
            ],
            children: [],
          },
        }),
      });
    });

    await page.route("**/api/user/collections", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "col-1",
              title: "Trips",
              slug: "trips",
              visibility: "private",
              parent_id: null,
              maps_count: 1,
              children_count: 0,
            },
          ],
        }),
      }),
    );
    await page.route("**/api/user/maps", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "map-1",
              title: "Morning Route",
              slug: "morning-route",
              visibility: "private",
            },
          ],
        }),
      }),
    );

    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");

    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /collections/i })
      .click();
    await expect(page.locator(".ogis-collections-panel")).toBeVisible();
    await expect(page.getByRole("button", { name: /Trips/i })).toBeVisible();

    await page.getByRole("button", { name: /Trips/i }).click();

    await page.locator("#collections-meta-title").fill("Updated Collection");
    await page.locator("#collections-meta-slug").fill("updated-collection");
    await page
      .locator("#collections-meta-description")
      .fill("Updated description.");
    await page.locator("#collections-meta-visibility").selectOption("public");
    await page.locator("#collections-meta-save").click();

    await expect(page.locator("#collections-meta-saved")).toBeVisible();
    await expect(page.locator("#collections-selected-title")).toContainText(
      "Updated Collection",
    );
    await expect.poll(() => updatePayload, { timeout: 5000 }).not.toBeNull();
    await expect.poll(() => collectionShowCalls, { timeout: 5000 }).toBe(2);
    await expect(updatePayload).toEqual(
      expect.objectContaining({
        title: "Updated Collection",
        slug: "updated-collection",
        description: "Updated description.",
        visibility: "public",
        parent_id: null,
        maps: ["map-1"],
      }),
    );
  });

  test("guest is prompted to use account panel for sign-in", async ({
    page,
  }) => {
    await withViewStorage(page);

    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: "{}",
      }),
    );

    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");

    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /collections/i })
      .click();

    await expect(
      page.getByText(
        "Sign in first to access your private collection resources.",
      ),
    ).toBeVisible();
    await page.locator("#collections-open-account").click();
    await expect(page.locator(".ogis-account-panel")).toBeVisible();
  });

  test("authenticated user can delete selected collection", async ({
    page,
  }) => {
    await withViewStorage(page);

    let collectionDeleted = false;

    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          username: "joe",
          created_at: "2026-04-01T10:00:00Z",
        }),
      }),
    );
    await page.route("**/sanctum/csrf-cookie", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );

    await page.route("**/api/user/collections/col-1*", async (route) => {
      const method = route.request().method();
      const requestOrigin =
        route.request().headers().origin ?? "http://127.0.0.1:4173";
      const requestHeaders =
        route.request().headers()["access-control-request-headers"] ?? "*";
      const preflightHeaders = {
        "access-control-allow-origin": requestOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,DELETE,OPTIONS",
        "access-control-allow-headers": requestHeaders,
      };

      if (method === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: preflightHeaders,
          body: "",
        });
        return;
      }

      if (method === "DELETE") {
        collectionDeleted = true;
        await route.fulfill({ status: 204, body: "" });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "col-1",
            title: "Trips",
            slug: "trips",
            description: "Original description.",
            visibility: "private",
            parent_id: null,
            maps_count: 0,
            children_count: 0,
            maps: [],
            children: [],
          },
        }),
      });
    });

    await page.route("**/api/user/collections", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: collectionDeleted
            ? []
            : [
                {
                  id: "col-1",
                  title: "Trips",
                  slug: "trips",
                  visibility: "private",
                  parent_id: null,
                  maps_count: 0,
                  children_count: 0,
                },
              ],
        }),
      }),
    );
    await page.route("**/api/user/maps", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      }),
    );

    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");

    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /collections/i })
      .click();
    await page.getByRole("button", { name: /Trips/i }).click();
    await page.locator("#collections-delete").click();

    await expect(page.locator("#collections-delete-saved")).toBeVisible();
    await expect(page.getByRole("button", { name: /Trips/i })).toHaveCount(0);
    await expect(
      page.getByText("Select a collection to view and edit details."),
    ).toBeVisible();
  });
});
/* end */
