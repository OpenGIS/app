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

test.describe.skip("Account feature", () => {
  test("account tab in sidebar opens account panel", async ({ page }) => {
    await withViewStorage(page);
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ status: 401, body: "{}" }),
    );

    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /account/i })
      .click();

    await expect(page.locator(".ogis-account-panel")).toBeVisible();
    await expect(page.locator("#account-email")).toBeVisible();
  });

  test("magic link form posts email and intended callback url", async ({
    page,
    baseURL,
  }) => {
    await withViewStorage(page);
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ status: 401, body: "{}" }),
    );
    await page.route("**/sanctum/csrf-cookie", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );

    let requestBody = null;
    await page.route("**/api/auth/magic-link", async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, body: "{}" });
    });

    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /account/i })
      .click();

    await page.locator("#account-email").fill("user@example.com");
    await page.locator("#account-request-magic-link").click();

    await expect
      .poll(() => requestBody, { timeout: 5000 })
      .toEqual(expect.objectContaining({ email: "user@example.com" }));
    await expect(requestBody.intended).toContain(
      baseURL || "http://localhost:5184",
    );
    await expect(
      page.getByText("Magic link sent! Check your email."),
    ).toBeVisible();
  });

  test("authenticated session shows account details and supports logout", async ({
    page,
  }) => {
    await withViewStorage(page);

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
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );

    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /account/i })
      .click();

    await expect(page.getByText("Signed in as:")).toBeVisible();
    await expect(page.getByText("joe")).toBeVisible();

    await page.locator("#account-logout").click();
    await expect(page.locator("#account-email")).toBeVisible();
  });
});
/* end */
