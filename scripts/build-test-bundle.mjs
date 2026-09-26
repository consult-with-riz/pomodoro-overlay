/**
 * Bundle the render core for the golden tests.
 *
 * The goldens test src/draw.ts directly rather than through the app, so a
 * failure says "the drawing changed" and not "something in the UI changed".
 * esbuild is only used here; the app itself is built by Next.
 */
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(root + "tests/output", { recursive: true });

// A tiny entry that re-exports exactly what the test page calls.
const entry = root + "tests/output/core-entry.ts";
await writeFile(
  entry,
  `import { drawFrame, hsl } from "../../src/draw";
import { buildTimeline, stateAt, fmtClock, fmtLen, secondsShown } from "../../src/timeline";
import { FONTS, DEFAULTS, RES, SCREEN } from "../../src/settings";
import { bellSample, bellTimes, BELL_LEN } from "../../src/bell";
import { renderVideo, detectCapabilities, estimate, outputName } from "../../src/export";
(globalThis as any).__core = {
  drawFrame, hsl, buildTimeline, stateAt, fmtClock, fmtLen, secondsShown,
  FONTS, DEFAULTS, RES, SCREEN, bellSample, bellTimes, BELL_LEN,
  renderVideo, detectCapabilities, estimate, outputName,
};
`
);

await build({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: root + "tests/output/core.js",
  logLevel: "warning",
});

console.log("Built tests/output/core.js");
