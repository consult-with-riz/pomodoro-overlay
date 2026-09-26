/**
 * Capture reference frames from the prototype.
 *
 * Run this once, against the prototype, BEFORE the rewrite exists. The PNGs it
 * writes to tests/golden/ are the contract the ported app has to satisfy:
 * ffprobe can only tell you a video has the right codec and duration, not that
 * the pixels are right, so these close that gap.
 *
 * Usage:
 *   npm run golden              capture (refuses to overwrite)
 *   npm run golden -- --force   re-capture after an intentional visual change
 */
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { serve } from "./serve.mjs";
import { CASES, settingsFor, WIDTH, HEIGHT } from "./golden-cases.mjs";

const OUT = fileURLToPath(new URL("../tests/golden/", import.meta.url));
const force = process.argv.includes("--force");

await mkdir(OUT, { recursive: true });
const existing = (await readdir(OUT)).filter((f) => f.endsWith(".png"));
if (existing.length && !force) {
  console.error(
    `tests/golden/ already holds ${existing.length} PNGs.\n` +
      `Re-capturing rewrites the contract the rewrite is tested against, so it ` +
      `needs --force and a reason in the commit message.`
  );
  process.exit(1);
}

const { url, close } = await serve();
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });

  const failures = [];
  page.on("pageerror", (e) => failures.push(String(e)));
  page.on("requestfailed", (r) => failures.push(`${r.url()} failed`));

  await page.goto(`${url}/reference/prototype-harness.html`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => window.__protoReady);
  await page.evaluate(() => window.__protoReady);

  if (failures.length) {
    throw new Error("Harness reported errors:\n  " + failures.join("\n  "));
  }

  // Guard against capturing goldens drawn with a fallback font, which is the
  // exact failure this whole harness exists to catch.
  const fontsOk = await page.evaluate(() => {
    const families = Object.values(window.__proto.FONTS).map((f) => f.family);
    return families.map((family) => ({
      family,
      loaded: document.fonts.check(`800 100px ${family}`),
    }));
  });
  const missing = fontsOk.filter((f) => !f.loaded);
  if (missing.length) {
    throw new Error(
      "These faces did not load, goldens would bake in a fallback:\n  " +
        missing.map((m) => m.family).join("\n  ")
    );
  }

  for (const testCase of CASES) {
    const settings = settingsFor(testCase);
    const dataUrl = await page.evaluate(
      ([settings, t, W, H]) => {
        const { drawFrame, buildTimeline } = window.__proto;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d", { alpha: true });
        const timeline = buildTimeline(settings);
        drawFrame(ctx, W, H, timeline, t, settings, settings.bg);
        return canvas.toDataURL("image/png");
      },
      [settings, testCase.t, WIDTH, HEIGHT]
    );

    const png = Buffer.from(dataUrl.split(",")[1], "base64");
    await writeFile(OUT + testCase.name + ".png", png);
    console.log(`  ${testCase.name}.png  (${(png.length / 1024).toFixed(1)} KB)`);
  }

  // Record what the timeline maths produced, so a change to buildTimeline or
  // the clock formatting fails loudly instead of quietly shifting every frame.
  const facts = await page.evaluate((settings) => {
    const { buildTimeline, stateAt, fmtClock } = window.__proto;
    const timeline = buildTimeline(settings);
    const at = (t) => {
      const state = stateAt(timeline, t);
      // The end screen always reads zero regardless of count direction. The
      // prototype does this in both drawFrame and its live tick; it has to be
      // repeated here because the prototype doesn't expose it as a function.
      const secs =
        state.seg.kind === "done"
          ? 0
          : settings.direction === "up"
            ? Math.floor(state.local)
            : state.seg.dur - Math.floor(state.local);
      return { kind: state.seg.kind, round: state.seg.round, clock: fmtClock(secs, timeline.hours) };
    };
    return {
      total: timeline.total,
      rounds: timeline.rounds,
      segments: timeline.segs.map((s) => ({ kind: s.kind, dur: s.dur, start: s.start })),
      samples: Object.fromEntries([1, 5, 65, 130, 246].map((t) => [t, at(t)])),
    };
  }, settingsFor({ t: 0 }));

  await writeFile(OUT + "timeline.json", JSON.stringify(facts, null, 2) + "\n");

  console.log(`\nCaptured ${CASES.length} frames + timeline.json`);
  console.log(`Total ${facts.total}s across ${facts.segments.length} segments`);
  console.log(`t=5s reads ${facts.samples[5].clock} (${facts.samples[5].kind})`);
} finally {
  await browser.close();
  await close();
}
