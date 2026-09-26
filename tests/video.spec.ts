/**
 * End-to-end checks on the actual encoded file.
 *
 * The golden tests prove drawFrame is right. These prove the export path
 * carries that drawing into a real container: correct codec, size and
 * duration, a genuine alpha channel on the transparent output, and — the one
 * that ties it together — a frame pulled back out of the video matching the
 * golden for the same moment.
 */
import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import ffmpegPath from "ffmpeg-static";
import { path as ffprobePath } from "@ffprobe-installer/ffprobe";
import { settingsFor } from "../scripts/golden-cases.mjs";

const run = promisify(execFile);
const OUTPUT = fileURLToPath(new URL("./output/", import.meta.url));
const GOLDEN = fileURLToPath(new URL("./golden/", import.meta.url));

/** 2480 frames of real encoding; well past Playwright's default. */
const RENDER_TIMEOUT = 8 * 60 * 1000;

interface Stream {
  codec_name: string;
  width?: number;
  height?: number;
  [k: string]: unknown;
}

async function probe(file: string): Promise<{ streams: Stream[]; format: Record<string, unknown> }> {
  const { stdout } = await run(ffprobePath, [
    "-v", "error",
    "-show_streams",
    "-show_format",
    "-of", "json",
    file,
  ]);
  return JSON.parse(stdout);
}

/**
 * Render in the page and bring the bytes back.
 *
 * Chunked base64 because a single String.fromCharCode over a multi-megabyte
 * buffer blows the argument limit.
 */
async function renderInPage(
  page: import("@playwright/test").Page,
  settings: Record<string, unknown>
): Promise<Buffer> {
  const base64 = await page.evaluate(async (settings) => {
    const core = (window as any).__core;
    const canvas = document.createElement("canvas");
    const { blob } = await core.renderVideo({ settings, canvas });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let out = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(out);
  }, settings);
  return Buffer.from(base64, "base64");
}

test.describe("encoded output", () => {
  test.beforeAll(async () => {
    await mkdir(OUTPUT, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/tests/core-page.html", { waitUntil: "networkidle" });
    await page.evaluate(() => (window as any).__coreReady);
  });

  test("green MP4 is h264 1280x720 and 248 seconds", async ({ page }) => {
    test.setTimeout(RENDER_TIMEOUT);

    const settings = settingsFor({ name: "video", t: 0 });
    const file = OUTPUT + "green-720p.mp4";
    await writeFile(file, await renderInPage(page, { ...settings, bg: "green" }));

    const info = await probe(file);
    const video = info.streams.find((s) => s.codec_name === "h264");

    expect(video, "an h264 stream").toBeTruthy();
    expect(video!.width).toBe(1280);
    expect(video!.height).toBe(720);

    const duration = Number(info.format.duration);
    // One frame of slack at 10 fps for container rounding.
    expect(duration).toBeGreaterThan(247.8);
    expect(duration).toBeLessThan(248.3);
  });

  test("transparent WebM is vp9 with a real alpha channel", async ({ page }) => {
    test.setTimeout(RENDER_TIMEOUT);

    const settings = settingsFor({ name: "video", t: 0 });
    const file = OUTPUT + "transparent-720p.webm";
    await writeFile(
      file,
      await renderInPage(page, { ...settings, bg: "transparent", shadow: true })
    );

    const info = await probe(file);
    const video = info.streams.find((s) => s.codec_name === "vp9");
    expect(video, "a vp9 stream").toBeTruthy();
    expect(video!.width).toBe(1280);
    expect(video!.height).toBe(720);

    // Pull a frame out as RGBA and check a corner is fully transparent. A VP9
    // file without alpha decodes to opaque here, which is the regression this
    // is guarding against.
    const frame = OUTPUT + "transparent-corner.png";
    await run(ffmpegPath!, [
      "-y", "-v", "error",
      "-c:v", "libvpx-vp9",
      "-i", file,
      "-vf", "select=eq(n\\,50)",
      "-vframes", "1",
      "-pix_fmt", "rgba",
      frame,
    ]);

    const png = PNG.sync.read(await readFile(frame));
    const alphaAt = (x: number, y: number) => png.data[((png.width * y + x) << 2) + 3];

    expect(alphaAt(0, 0), "top-left alpha").toBe(0);
    expect(alphaAt(png.width - 1, png.height - 1), "bottom-right alpha").toBe(0);
  });

  test("black output is opaque black, not transparent", async ({ page }) => {
    test.setTimeout(RENDER_TIMEOUT);

    const settings = settingsFor({ name: "video", t: 0 });
    const file = OUTPUT + "black-720p.mp4";
    await writeFile(file, await renderInPage(page, { ...settings, bg: "black" }));

    const info = await probe(file);
    expect(info.streams.find((s) => s.codec_name === "h264"), "an h264 stream").toBeTruthy();

    const frame = OUTPUT + "black-corner.png";
    await run(ffmpegPath!, [
      "-y", "-v", "error",
      "-ss", "5",
      "-i", file,
      "-vframes", "1",
      "-pix_fmt", "rgba",
      frame,
    ]);

    const png = PNG.sync.read(await readFile(frame));
    const at = (x: number, y: number) => {
      const i = (png.width * y + x) << 2;
      return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
    };

    const [r, g, b, a] = at(4, 4);
    // Opaque, and black rather than the green screen colour. A Screen blend
    // in an editor relies on this being genuinely black.
    expect(a).toBe(255);
    expect(Math.max(r, g, b)).toBeLessThan(12);
  });

  test("an ambient bed is actually written into the audio", async ({ page }) => {
    test.setTimeout(RENDER_TIMEOUT);

    // One minute, so two renders stay quick.
    const base = {
      ...settingsFor({ name: "video", t: 0 }),
      focusMin: 1,
      breakMin: 0,
      rounds: 1,
      leadSec: 0,
      outroSec: 0,
      bg: "green",
    };

    const silent = await renderInPage(page, { ...base, noise: "none" });
    const withBed = await renderInPage(page, {
      ...base,
      noise: "brown",
      noiseVolume: 0.3,
    });

    await writeFile(OUTPUT + "bed-off.mp4", silent);
    await writeFile(OUTPUT + "bed-on.mp4", withBed);

    const info = await probe(OUTPUT + "bed-on.mp4");
    expect(info.streams.find((s) => s.codec_type === "audio"), "an audio stream").toBeTruthy();

    // Noise is incompressible, so a continuous bed has to cost real bytes.
    // If it were silently dropped the two files would be about the same size.
    const grew = withBed.length - silent.length;
    expect(
      grew,
      `bed added only ${(grew / 1024).toFixed(0)}KB over 60s — it may not be in the file`
    ).toBeGreaterThan(200_000);
  });

  test("a frame from the video matches the golden for that moment", async ({ page }) => {
    test.setTimeout(RENDER_TIMEOUT);

    const settings = settingsFor({ name: "video", t: 0 });
    const file = OUTPUT + "green-frame-check.mp4";
    await writeFile(file, await renderInPage(page, { ...settings, bg: "green" }));

    // t=5s, the same moment as seg-focus-t5.png.
    const frame = OUTPUT + "video-t5.png";
    await run(ffmpegPath!, [
      "-y", "-v", "error",
      "-ss", "5",
      "-i", file,
      "-vframes", "1",
      frame,
    ]);

    const actual = PNG.sync.read(await readFile(frame));
    const expected = PNG.sync.read(await readFile(GOLDEN + "seg-focus-t5.png"));

    expect({ w: actual.width, h: actual.height }).toEqual({
      w: expected.width,
      h: expected.height,
    });

    const diff = new PNG({ width: expected.width, height: expected.height });
    const differing = pixelmatch(
      expected.data,
      actual.data,
      diff.data,
      expected.width,
      expected.height,
      // Lossy H.264, so this is tuned to catch a blank or wrong frame rather
      // than to police compression artefacts.
      { threshold: 0.25 }
    );

    const ratio = differing / (expected.width * expected.height);
    if (ratio > 0.02) {
      await writeFile(OUTPUT + "video-t5.diff.png", PNG.sync.write(diff));
    }
    expect(
      ratio,
      `${(ratio * 100).toFixed(2)}% of pixels differ from the golden. ` +
        `See tests/output/video-t5.diff.png`
    ).toBeLessThanOrEqual(0.02);
  });
});
