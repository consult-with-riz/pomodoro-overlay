/**
 * The test that catches a wrong picture.
 *
 * ffprobe can confirm a video has the right codec, size and duration while
 * every frame of it is blank. These compare actual pixels from src/draw.ts
 * against frames captured from the prototype before the port started.
 */
import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { CASES, settingsFor, WIDTH, HEIGHT } from "../scripts/golden-cases.mjs";

const GOLDEN = fileURLToPath(new URL("./golden/", import.meta.url));
const OUTPUT = fileURLToPath(new URL("./output/", import.meta.url));

/**
 * Antialiasing differs very slightly between Chrome builds, so an exact match
 * is too brittle to be useful. 0.15% of pixels allowed to differ catches a
 * moved element or a fallback font while tolerating a rounding change.
 */
const MAX_DIFF_RATIO = 0.0015;
const PIXEL_THRESHOLD = 0.1;

test.describe("golden frames", () => {
  test.beforeAll(async () => {
    await mkdir(OUTPUT, { recursive: true });
  });

  for (const testCase of CASES) {
    test(testCase.name, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      await page.goto("/tests/core-page.html", { waitUntil: "networkidle" });
      await page.evaluate(() => (window as any).__coreReady);
      expect(errors, "page errors").toEqual([]);

      const dataUrl: string = await page.evaluate(
        ([settings, t, W, H]) => (window as any).__render(settings, t, W, H),
        [settingsFor(testCase), testCase.t, WIDTH, HEIGHT] as const
      );

      const actual = PNG.sync.read(
        Buffer.from(dataUrl.split(",")[1], "base64")
      );
      const expected = PNG.sync.read(
        await readFile(GOLDEN + testCase.name + ".png")
      );

      expect(
        { width: actual.width, height: actual.height },
        "canvas size"
      ).toEqual({ width: expected.width, height: expected.height });

      const diff = new PNG({ width: expected.width, height: expected.height });
      const differing = pixelmatch(
        expected.data,
        actual.data,
        diff.data,
        expected.width,
        expected.height,
        { threshold: PIXEL_THRESHOLD }
      );

      const ratio = differing / (expected.width * expected.height);
      if (ratio > MAX_DIFF_RATIO) {
        // Write all three so a failure can be looked at rather than guessed at.
        await writeFile(OUTPUT + testCase.name + ".actual.png", PNG.sync.write(actual));
        await writeFile(OUTPUT + testCase.name + ".diff.png", PNG.sync.write(diff));
      }

      expect(
        ratio,
        `${differing} pixels differ (${(ratio * 100).toFixed(3)}%). ` +
          `See tests/output/${testCase.name}.diff.png`
      ).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    });
  }
});

test("timeline maths matches the prototype", async ({ page }) => {
  await page.goto("/tests/core-page.html", { waitUntil: "networkidle" });
  await page.evaluate(() => (window as any).__coreReady);

  const recorded = JSON.parse(await readFile(GOLDEN + "timeline.json", "utf8"));

  const actual = await page.evaluate((settings) => {
    const c = (window as any).__core;
    const tl = c.buildTimeline(settings);
    const at = (t: number) => {
      const st = c.stateAt(tl, t);
      return {
        kind: st.seg.kind,
        round: st.seg.round,
        clock: c.fmtClock(c.secondsShown(st, settings.direction), tl.hours),
      };
    };
    return {
      total: tl.total,
      rounds: tl.rounds,
      segments: tl.segs.map((s: any) => ({
        kind: s.kind,
        dur: s.dur,
        start: s.start,
      })),
      samples: Object.fromEntries([1, 5, 65, 130, 246].map((t) => [t, at(t)])),
    };
  }, settingsFor({ name: "base", t: 0 }));

  expect(actual).toEqual(recorded);
  // Spelled out because CLAUDE.md names these numbers directly.
  expect(actual.total).toBe(248);
  expect(actual.samples["5"]).toMatchObject({ kind: "focus", clock: "00:58" });
});
