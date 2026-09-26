/**
 * Smoke tests against the built app.
 *
 * The golden and video specs test the core in isolation; these check the page
 * actually wires it up — that it loads without errors, the timer runs, and
 * settings survive a reload.
 */
import { test, expect } from "@playwright/test";

const APP = "http://127.0.0.1:4302";
const OVERLAY = `${APP}/overlay`;

test.describe("overlay maker", () => {
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

    await page.goto(OVERLAY, { waitUntil: "networkidle" });
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
    await page.goto(OVERLAY, { waitUntil: "networkidle" });
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
    await page.goto(OVERLAY, { waitUntil: "networkidle" });

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

  test("choosing an editor picks the format that editor can open", async ({ page }) => {
    await page.goto(OVERLAY, { waitUntil: "networkidle" });

    // Premiere cannot import WebM with alpha, so it must not land on
    // transparent — this is the trap the picker exists to prevent.
    await page.getByLabel("What will you edit in?").selectOption({ label: "Adobe Premiere Pro" });
    await expect(page.getByRole("radio", { name: "Green" })).toBeChecked();
    await expect(page.getByText(/can't import WebM with alpha/)).toBeVisible();

    await page.getByLabel("What will you edit in?").selectOption({ label: "OBS Studio" });
    await expect(page.getByRole("radio", { name: "Clear" })).toBeChecked();

    await page
      .getByLabel("What will you edit in?")
      .selectOption({ label: "I'll use a Screen blend mode" });
    await expect(page.getByRole("radio", { name: "Black" })).toBeChecked();
  });

  test("changing the format by hand moves the editor select to match", async ({ page }) => {
    await page.goto(OVERLAY, { waitUntil: "networkidle" });

    await page.getByRole("radio", { name: "Black" }).check();
    // Otherwise the explanation underneath would describe a different format.
    await expect(page.getByLabel("What will you edit in?")).toHaveValue("screen");
  });

  test("a style preset sets several controls at once and stays editable", async ({ page }) => {
    await page.goto(OVERLAY, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Broadcast" }).click();
    await expect(page.getByRole("radio", { name: "Bar" })).toBeChecked();
    await expect(page.getByLabel("Behind the timer")).toHaveValue("dark");

    // A preset is a starting point, not a mode: the controls still work and
    // the chip lets go once you change something it set.
    await page.getByRole("radio", { name: "Ring" }).check();
    await expect(page.getByRole("button", { name: "Broadcast" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  test("black output warns about dark colours instead of hue clashes", async ({ page }) => {
    await page.goto(OVERLAY, { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: "Black" }).check();
    await page.getByLabel("Text colour").fill("#101010");

    // Under a Screen blend dark pixels vanish; that is a different failure
    // from a colour being keyed out, so it needs its own warning.
    await expect(page.getByText(/Screen blend will make dark pixels/)).toBeVisible();
  });

  test("the timeline names all four parts even when two are seconds long", async ({ page }) => {
    await page.goto(OVERLAY, { waitUntil: "networkidle" });

    // On the default session a 10s lead-in is about 2px of an hour-long bar
    // and the 5s end screen is 1px. Widening them would desync the playhead,
    // which maps linearly, so the structure is carried by the legend instead.
    const items = await page.locator(".legend li").allTextContents();
    expect(items).toHaveLength(4);
    expect(items.join(" ")).toContain("Get ready");
    expect(items.join(" ")).toContain("0:10");
    expect(items.join(" ")).toContain("0:05");

    // One tick per boundary between the four segments.
    await expect(page.locator(".tick")).toHaveCount(3);

    // And the bar itself stays proportional, so scrubbing is still honest.
    const widths = await page.locator(".strip div").evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().width)
    );
    expect(widths[1] / widths[2]).toBeGreaterThan(4);
  });

  test("warns when a colour would be keyed out with the screen", async ({ page }) => {
    await page.goto(OVERLAY, { waitUntil: "networkidle" });

    // A saturated green on a green screen is the case the warning exists for.
    // fill() goes through the native value setter, which React's synthetic
    // event system sees; assigning el.value directly does not.
    await page.getByLabel("Focus colour").fill("#22cc55");

    await expect(page.getByText(/will be keyed out with it/)).toBeVisible();
  });
});
