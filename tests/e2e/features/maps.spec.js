// Skip: features are commented out in src/main.js:16-20,113-116 — remove the skip when the features ship.
import { expect, test } from "@playwright/test";

const withViewStorage = (page) =>
  page.addInitScript(() =>
    localStorage.setItem(
      "onrte_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 12 },
      }),
    ),
  );

test.describe.skip("Maps feature", () => {
  test("authenticated user can list maps and open one for GeoJSON rendering", async ({
    page,
  }) => {
    await withViewStorage(page);

    let mapShowCalls = 0;

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

    await page.route("**/api/user/maps/map-1*", async (route) => {
      mapShowCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "map-1",
            title: "Morning Route",
            slug: "morning-route",
            visibility: "private",
            center: { lat: 50.6539, lng: -128.0094 },
            zoom: 12,
            geojson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [-128.0094, 50.6539],
                      [-128.005, 50.655],
                    ],
                  },
                  properties: {},
                },
              ],
            },
          },
        }),
      });
    });

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
            },
          ],
        }),
      }),
    );

    await page.goto("/");
    await page.waitForSelector(".onrte-map canvas");

    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /maps/i })
      .click();
    await expect(page.locator(".onrte-maps-panel")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Morning Route/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Morning Route/i }).click();

    await expect(page.locator("#maps-selected-title")).toContainText(
      "Morning Route",
    );
    await expect(page.getByText("Rendered features")).toBeVisible();
    await expect.poll(() => mapShowCalls, { timeout: 5000 }).toBe(1);
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
    await page.waitForSelector(".onrte-map canvas");

    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /maps/i })
      .click();

    await expect(
      page.getByText("Sign in first to access your private map resources."),
    ).toBeVisible();

    await page.locator("#maps-open-account").click();
    await expect(page.locator(".onrte-account-panel")).toBeVisible();
    await expect(page.locator("#account-email")).toBeVisible();
  });

  test("authenticated user can create a blank map", async ({ page }) => {
    await withViewStorage(page);

    let createPayload = null;
    let mapCreated = false;

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
            },
          ],
        }),
      }),
    );

    await page.route("**/api/user/maps*", async (route) => {
      const method = route.request().method();
      const requestOrigin =
        route.request().headers().origin ?? "http://127.0.0.1:4173";
      const requestHeaders =
        route.request().headers()["access-control-request-headers"] ?? "*";
      const preflightHeaders = {
        "access-control-allow-origin": requestOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,OPTIONS",
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

      if (method === "POST") {
        createPayload = route.request().postDataJSON();
        mapCreated = true;

        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              id: "map-2",
              title: "Blank Test Map",
              slug: "blank-test-map",
              description: "Created from tests.",
              visibility: "private",
              center: { lat: 0, lng: 0 },
              zoom: 10,
              collections: [{ id: "col-1" }],
              geojson: {
                type: "FeatureCollection",
                features: [],
              },
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: mapCreated
            ? [
                {
                  id: "map-2",
                  title: "Blank Test Map",
                  slug: "blank-test-map",
                  visibility: "private",
                },
              ]
            : [],
        }),
      });
    });

    await page.goto("/");
    await page.waitForSelector(".onrte-map canvas");
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /maps/i })
      .click();

    await page.locator("#maps-create-title").fill("Blank Test Map");
    await page.locator("#maps-create-slug").fill("blank-test-map");
    await page.locator("#maps-create-description").fill("Created from tests.");
    await page.locator("#maps-create-collections").selectOption(["col-1"]);
    await page.locator("#maps-create-save").click();

    await expect(page.locator("#maps-create-saved")).toBeVisible();
    await expect(page.locator("#maps-selected-title")).toContainText(
      "Blank Test Map",
    );
    await expect(
      page.getByRole("button", { name: /Blank Test Map/i }),
    ).toBeVisible();
    await expect.poll(() => createPayload, { timeout: 5000 }).not.toBeNull();
    await expect(createPayload).toEqual(
      expect.objectContaining({
        title: "Blank Test Map",
        slug: "blank-test-map",
        description: "Created from tests.",
        visibility: "private",
        collections: ["col-1"],
      }),
    );
    await expect(typeof createPayload.geojson).toBe("string");
    await expect(JSON.parse(createPayload.geojson)).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  test("authenticated user can delete selected map", async ({ page }) => {
    await withViewStorage(page);

    let mapDeleted = false;

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
    await page.route("**/api/user/collections", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      }),
    );

    await page.route("**/api/user/maps/map-1*", async (route) => {
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
        mapDeleted = true;
        await route.fulfill({ status: 204, body: "" });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "map-1",
            title: "Morning Route",
            slug: "morning-route",
            description: "Original description.",
            visibility: "private",
            center: { lat: 50.6539, lng: -128.0094 },
            zoom: 12,
            collections: [],
            geojson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [-128.0094, 50.6539],
                  },
                  properties: {},
                },
              ],
            },
          },
        }),
      });
    });

    await page.route("**/api/user/maps", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: mapDeleted
            ? []
            : [
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
    await page.waitForSelector(".onrte-map canvas");
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /maps/i })
      .click();
    await page.getByRole("button", { name: /Morning Route/i }).click();

    await page.locator("#maps-delete").click();

    await expect(page.locator("#maps-delete-saved")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Morning Route/i }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Select a map to render its GeoJSON."),
    ).toBeVisible();
  });

  test("authenticated user can update selected map metadata", async ({
    page,
  }) => {
    await withViewStorage(page);

    let mapShowCalls = 0;
    let updatePayload = null;
    let mapUpdated = false;

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
            },
            {
              id: "col-2",
              title: "Runs",
              slug: "runs",
              visibility: "private",
            },
          ],
        }),
      }),
    );

    await page.route("**/api/user/maps/map-1*", async (route) => {
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
        mapUpdated = true;

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              id: "map-1",
              title: "Updated Route Name",
              slug: "updated-route-name",
              description: "Updated description.",
              visibility: "public",
            },
          }),
        });
        return;
      }

      mapShowCalls += 1;

      const title = mapUpdated ? "Updated Route Name" : "Morning Route";
      const slug = mapUpdated ? "updated-route-name" : "morning-route";
      const description = mapUpdated
        ? "Updated description."
        : "Original description.";
      const visibility = mapUpdated ? "public" : "private";
      const collections = mapUpdated ? [{ id: "col-2" }] : [{ id: "col-1" }];

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "map-1",
            title,
            slug,
            description,
            visibility,
            center: { lat: 50.6539, lng: -128.0094 },
            zoom: 12,
            collections,
            geojson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [-128.0094, 50.6539],
                  },
                  properties: {},
                },
              ],
            },
          },
        }),
      });
    });

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
    await page.waitForSelector(".onrte-map canvas");
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /maps/i })
      .click();
    await page.getByRole("button", { name: /Morning Route/i }).click();

    await page.locator("#maps-meta-title").fill("Updated Route Name");
    await page.locator("#maps-meta-slug").fill("updated-route-name");
    await page.locator("#maps-meta-description").fill("Updated description.");
    await page.locator("#maps-meta-visibility").selectOption("public");
    await page.locator("#maps-meta-collections").selectOption(["col-2"]);
    await page.locator("#maps-meta-save").click();

    await expect(page.locator("#maps-meta-saved")).toBeVisible();
    await expect(page.locator("#maps-selected-title")).toContainText(
      "Updated Route Name",
    );
    await expect.poll(() => updatePayload, { timeout: 5000 }).not.toBeNull();
    await expect.poll(() => mapShowCalls, { timeout: 5000 }).toBe(2);
    await expect(updatePayload).toEqual(
      expect.objectContaining({
        title: "Updated Route Name",
        slug: "updated-route-name",
        description: "Updated description.",
        visibility: "public",
        collections: ["col-2"],
      }),
    );
    await expect(typeof updatePayload.geojson).toBe("string");
  });
});
/* end */
