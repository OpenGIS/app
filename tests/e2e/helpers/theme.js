import { expect } from "@playwright/test";

/**
 * Assert the app's single, fixed default theme.
 *
 * The `default` theme identity lives on <html> and its dark palette is compiled
 * into the base `:root`, so it never follows the OS/browser colour-scheme
 * preference. Pass `{ modal: true }` where a teleported modal is open to also
 * assert that its `.modal-content` inherits the same palette.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ modal?: boolean }} [options]
 */
export const expectDefaultTheme = async (page, { modal = false } = {}) => {
  const root = page.locator("html");

  await expect(root).toHaveAttribute("data-theme", "default");
  // The old runtime theme identity must be gone.
  await expect(root).not.toHaveAttribute("data-bs-theme", /.*/);

  const { colorScheme, metaColorScheme, htmlBg, bodyBgVar, bodyBg } =
    await page.evaluate(() => {
      const html = document.documentElement;
      return {
        colorScheme: getComputedStyle(html).colorScheme,
        metaColorScheme: document
          .querySelector('meta[name="color-scheme"]')
          ?.getAttribute("content"),
        htmlBg: getComputedStyle(html).backgroundColor,
        bodyBgVar: getComputedStyle(html)
          .getPropertyValue("--bs-body-bg")
          .trim(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
      };
    });

  expect(colorScheme).toBe("dark");
  // The boot surface must advertise dark before any CSS paints.
  expect(metaColorScheme).toBe("dark");
  // The base `:root` dark palette paints the html element itself.
  expect(htmlBg).toBe("rgb(33, 37, 41)");
  expect(bodyBgVar).toBe("#212529");
  expect(bodyBg).toBe("rgb(33, 37, 41)");

  if (modal) {
    const content = page.locator(".modal-content").first();
    await expect(content).toBeVisible();
    const modalBg = await content.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(modalBg).toBe("rgb(33, 37, 41)");
  }
};
