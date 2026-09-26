/**
 * Smoke tests against the built app.
 *
 * The golden and video specs test the core in isolation; these check the page
 * actually wires it up — that it loads without errors, the timer runs, and
 * settings survive a reload.
 */
import { test, expect } from "@playwright/test";

const APP = "http://127.0.0.1:4302";

test.describe("app", () => {
  test("loads with no console errors and draws a preview", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      // The generic "Failed to load resource" line has no URL on it, so the
      // response listener below is what identifies a real problem.
      if (m.type() === "error" && !m.text().includes("Failed to load resource")) {
        errors.push(`console: ${m.text()}`);
      }
    });
    // Console messages for a failed fetch carry no URL, so failures are
    // tracked from responses instead, where the path is visible.
    // /_vercel/* is injected by Vercel's edge and only exists once deployed,
    // so it always 404s against a local next start.
    page.on("response", (r) => {
      const path = new URL(r.url()).pathname;
      if (r.status() >= 400 && !path.startsWith("/_vercel/")) {
        errors.push(`${r.status()} ${path}`);
      }
    });

    await page.goto(APP, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Pomodoro timer" })).toBeVisible();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    // The preview should have drawn something, not be a blank element.
    await expect
      .poll(
        async () =>
          canvas.evaluate((el: HTMLCanvasElement) => el.width * el.height),
        { timeout: 5000 }
      )
      .toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test("the timer runs and updates the document title", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start" }).click();

    // Default session opens with a 10s lead-in labelled "Get ready".
    await expect.poll(() => page.title(), { timeout: 6000 }).toMatch(/Get ready/);
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    await page.getByRole("button", { name: "Pause" }).click();
    await expect.poll(() => page.title(), { timeout: 4000 }).toBe(
      "Pomodoro timer and overlay maker"
    );
  });

  test("settings persist across a reload", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });

    const focus = page.getByLabel("Focus (minutes)");
    await focus.fill("33");
    // Give the persistence effect a turn to run.
    await expect.poll(
      () => page.evaluate(() => localStorage.getItem("pomodoro-overlay-settings-v1")),
      { timeout: 4000 }
    ).toContain('"focusMin":33');

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByLabel("Focus (minutes)")).toHaveValue("33");
  });

  test("warns when a colour would be keyed out with the screen", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });

    // A saturated green on a green screen is the case the warning exists for.
    // fill() goes through the native value setter, which React's synthetic
    // event system sees; assigning el.value directly does not.
    await page.getByLabel("Focus colour").fill("#22cc55");

    await expect(page.getByText(/will be keyed out with it/)).toBeVisible();
  });
});
