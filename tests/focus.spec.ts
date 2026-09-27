/**
 * The focus timer at /.
 *
 * Covers the things that would quietly ruin someone's session: the clock
 * drifting, a refresh wiping a 40 minute block, or the phase change not
 * happening. Audio is not asserted — there is no way to hear it in a headless
 * browser — but the page is checked for errors while it runs.
 */
import { test, expect } from "@playwright/test";

const APP = "http://127.0.0.1:4302";

/** Read the big clock as seconds. */
async function clockSeconds(page: import("@playwright/test").Page): Promise<number> {
  const text = (await page.locator(".dial__time").textContent())?.trim() ?? "";
  const parts = text.split(":").map(Number);
  if (parts.some(Number.isNaN)) throw new Error(`Unreadable clock: "${text}"`);
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

test.describe("focus timer", () => {
  test("loads clean and starts on the default preset", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("response", (r) => {
      const path = new URL(r.url()).pathname;
      if (r.status() >= 400 && !path.startsWith("/_vercel/")) {
        errors.push(`${r.status()} ${path}`);
      }
    });

    await page.goto(APP, { waitUntil: "networkidle" });

    // 25/5 is the default, so the clock opens at 25:00 with nothing configured.
    await expect(page.locator(".dial__time")).toHaveText("25:00");
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    // The whole point is that there is no sidebar to get past.
    await expect(page.locator(".sheet--open")).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("counts down and the title follows", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start" }).click();

    await expect.poll(() => page.title(), { timeout: 6000 }).toMatch(/Focus/);

    const first = await clockSeconds(page);
    await page.waitForTimeout(2200);
    const second = await clockSeconds(page);

    expect(second).toBeLessThan(first);
    // Two seconds of wall clock should move it about two seconds, not ten.
    expect(first - second).toBeGreaterThanOrEqual(1);
    expect(first - second).toBeLessThanOrEqual(4);
  });

  test("a preset changes the session without needing the settings sheet", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });

    // Past an hour the clock gains an hours field, so 90 minutes reads
    // 1:30:00 rather than 90:00.
    await page.getByRole("button", { name: "90 / 15" }).click();
    await expect(page.locator(".dial__time")).toHaveText("1:30:00");

    await page.getByRole("button", { name: "25 / 5" }).click();
    await expect(page.locator(".dial__time")).toHaveText("25:00");
  });

  test("skipping moves to the break and the phase changes", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.locator(".dial__phase")).toHaveText("Focus");

    const focusAccent = await page
      .locator(".focus")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--phase-accent").trim());

    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.locator(".dial__phase")).toHaveText("Break");

    const breakAccent = await page
      .locator(".focus")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--phase-accent").trim());

    // The background following the phase is the feature, so it is asserted.
    expect(breakAccent).not.toBe(focusAccent);
  });

  test("a running session survives a reload", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForTimeout(2500);

    const before = await clockSeconds(page);
    expect(before).toBeLessThan(25 * 60);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".dial__time")).toBeVisible();
    const after = await clockSeconds(page);

    // Losing a long focus block to an accidental refresh is the worst thing
    // this app could do, so the position has to come back roughly where it was.
    expect(Math.abs(after - before)).toBeLessThanOrEqual(3);
  });

  test("the clock does not change width as the digits change", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });

    // The typeface has no tabular figures, so font-variant-numeric is ignored
    // and "1" is a third narrower than "4". Without fixed cells the whole
    // clock shifts every second. Guarded because it fails silently.
    const widths = await page.evaluate(() => {
      const el = document.querySelector(".dial__time");
      if (!el) throw new Error("no clock");
      const original = el.innerHTML;
      const cell = (ch: string) => {
        const s = document.createElement("span");
        s.className = ch === ":" ? "dial__colon" : "dial__digit";
        s.textContent = ch;
        return s;
      };
      const measure = (str: string) => {
        el.replaceChildren(...str.split("").map(cell));
        return el.getBoundingClientRect().width;
      };
      const out = ["00:00", "11:11", "38:38", "44:44", "25:00"].map(measure);
      el.innerHTML = original;
      return out;
    });

    const spread = Math.max(...widths) - Math.min(...widths);
    expect(spread, `clock width varies by ${spread.toFixed(2)}px across digits`).toBeLessThan(0.5);
  });

  test("the clock stays inside the ring, including past an hour", async ({ page }) => {
    // Sizing the clock from the viewport rather than from the dial meant even
    // 25:00 spilled 76px past the ring, and a three hour session was far
    // worse. The type is now derived from the dial and the string's own
    // length, so both have to fit whatever the session is.
    const fits = async (label: string) => {
      const { dial, clock, text } = await page.evaluate(() => {
        const d = document.querySelector(".dial")!.getBoundingClientRect();
        const t = document.querySelector(".dial__time")!;
        return {
          dial: d.width,
          clock: t.getBoundingClientRect().width,
          text: t.textContent ?? "",
        };
      });
      // The ring's own stroke eats into the usable width, so 80% of the
      // diameter is the generous bound; anything wider is touching it.
      expect(
        clock,
        `${label}: "${text}" is ${Math.round(clock)}px in a ${Math.round(dial)}px dial`
      ).toBeLessThan(dial * 0.8);
    };

    await page.goto(APP, { waitUntil: "networkidle" });
    await fits("25:00");

    await page.getByRole("button", { name: "90 / 15" }).click();
    await page.waitForTimeout(300);
    await fits("1:30:00");

    // The case reported: 3h15 focus blocks.
    await page.addInitScript(() => {
      localStorage.setItem(
        "pomodoro-focus-settings-v1",
        JSON.stringify({ focusMin: 195, breakMin: 15, rounds: 1, presetId: "custom" })
      );
    });
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await expect(page.locator(".dial__time")).toHaveText("3:15:00");
    await fits("3:15:00");
  });

  test("everything fits without scrolling", async ({ page }) => {
    // A laptop viewport. The shortcut line used to fall below the fold.
    for (const height of [760, 860, 960]) {
      await page.setViewportSize({ width: 1440, height });
      await page.goto(APP, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight
      );
      expect(overflow, `page scrolls by ${overflow}px at ${height}px tall`).toBeLessThanOrEqual(0);
      await expect(page.locator(".focus__keys")).toBeInViewport();
    }
  });

  test("background sound can be changed without opening settings", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });

    // The thing people change per session is inline; what you set once is not.
    await page.getByRole("button", { name: "Sound off" }).click();
    await page.getByRole("button", { name: "Brown noise", exact: true }).click();
    await expect(page.locator(".sound > .chip")).toHaveText("Brown noise");
    await expect(page.locator(".sheet--open")).toHaveCount(0);

    // The popover must not sit over the primary action.
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  test("the tip link is there for the whole of a running session", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });

    // Not before the timer runs: there is nothing to have helped with yet.
    await expect(page.locator(".focus__idletip")).toHaveCount(0);

    // And from the moment it does, not some way into it. A delay here made
    // the link impossible to find.
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.locator(".focus__idletip")).toBeVisible();
  });

  test("the tip line is pointed at once, on a first session only", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await expect(page.locator(".nudge")).toHaveCount(0);

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.locator(".nudge")).toHaveCount(1);
    // Brought fully up for the moment, rather than left at its usual whisper.
    await expect
      .poll(() =>
        page.locator(".focus__idletip").evaluate((e) => Number(getComputedStyle(e).opacity))
      )
      .toBeGreaterThan(0.9);

    // And then it gets out of the way.
    await expect(page.locator(".nudge")).toHaveCount(0, { timeout: 6000 });
    await expect
      .poll(() =>
        page.locator(".focus__idletip").evaluate((e) => Number(getComputedStyle(e).opacity))
      )
      .toBeLessThan(0.6);

    // Never again in this browser. Being pointed at a payment request every
    // time you sit down to work is nagging, not attention.
    await page.mouse.move(700, 500);
    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("button", { name: "Reset" }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForTimeout(600);
    await expect(page.locator(".nudge")).toHaveCount(0);

    // The flag is what remembers, so it survives a reload too.
    expect(
      await page.evaluate(() => localStorage.getItem("pomodoro-focus-nudged-v1"))
    ).toBe("1");
  });

  test("the in-session tip link stays reachable when the chrome fades", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.locator(".focus__idletip")).toBeVisible();

    // Reaching for it moves the pointer, which wakes the page. If it were
    // only rendered while idle it would vanish on the way to being clicked,
    // so it has to survive leaving the idle state.
    await page.mouse.move(700, 450);
    await page.waitForTimeout(5200);
    await expect(page.locator(".focus")).toHaveClass(/focus--idle/);
    await expect(page.locator(".focus__idletip")).toBeVisible();

    await page.mouse.move(720, 470);
    await page.waitForTimeout(400);
    await expect(page.locator(".focus")).not.toHaveClass(/focus--idle/);
    await expect(page.locator(".focus__idletip")).toBeVisible();

    await page.locator(".focus__idletip .tip").click({ trial: true });
  });

  test("no tip link is ever rendered without a destination", async ({ page }) => {
    // A support button that leads nowhere is worse than none at all.
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Skip" }).click();
    await page.waitForTimeout(400);

    const hrefs = await page.locator(".tip").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href"))
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^https?:\/\/.+/);
  });

  test("the task name is kept", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByPlaceholder("What are you working on?").fill("Write the script");

    await expect
      .poll(
        () => page.evaluate(() => localStorage.getItem("pomodoro-focus-settings-v1")),
        { timeout: 4000 }
      )
      .toContain("Write the script");

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByPlaceholder("What are you working on?")).toHaveValue(
      "Write the script"
    );
  });

  test("the two routes link to each other", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /overlay/i }).first().click();
    await expect(page).toHaveURL(/\/overlay$/);

    await page.getByRole("link", { name: /plain timer/i }).click();
    await expect(page).toHaveURL(new RegExp(`${APP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`));
  });

  test("focus settings do not leak into the overlay maker", async ({ page }) => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "90 / 15" }).click();
    await expect(page.locator(".dial__time")).toHaveText("1:30:00");

    // Separate stores on purpose: someone who set up a green screen for a
    // video should not find their workspace turned green, and vice versa.
    await page.goto(`${APP}/overlay`, { waitUntil: "networkidle" });
    await expect(page.getByLabel("Focus (minutes)")).toHaveValue("50");
  });
});
