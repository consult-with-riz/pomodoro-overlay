/**
 * Generate reference/prototype-harness.html from the untouched prototype.
 *
 * The prototype wraps everything in an IIFE, so its pure functions aren't
 * reachable from a test. Rather than edit the reference copy (which has to stay
 * pristine as the spec), this derives a harness that:
 *   - swaps the Google Fonts <link> for the pinned local faces, so goldens are
 *     captured with the same files the app will ship
 *   - hangs the pure core on window.__proto for direct calls
 *
 * Regenerate with `npm run harness`. The output is git-ignored.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../reference/", import.meta.url));
const src = await readFile(dir + "pomodoro-overlay.html", "utf8");

// 1. Point at the pinned fonts instead of Google's CDN.
const withFonts = src.replace(
  /<link rel="preconnect"[\s\S]*?rel="stylesheet">/,
  '<link rel="stylesheet" href="/fonts/fonts.css">'
);
if (withFonts === src) {
  throw new Error("Could not find the Google Fonts <link> to replace");
}

// 2. Expose the pure core just before the IIFE closes.
const EXPOSE = `
/* --- test harness: added by scripts/build-harness.mjs, not in the prototype --- */
window.__proto = { drawFrame, buildTimeline, stateAt, fmtClock, DEFAULTS, FONTS, RES, bellTimes };
window.__protoReady = (async () => {
  await document.fonts.ready;
  const pending = [];
  for (const f of Object.values(FONTS)) {
    pending.push(document.fonts.load(\`\${f.num} 100px \${f.family}\`));
    pending.push(document.fonts.load(\`\${f.lab} 100px \${f.family}\`));
  }
  await Promise.all(pending);
  return true;
})();
`;

const marker = "\n})();";
const at = withFonts.lastIndexOf(marker);
if (at === -1) throw new Error("Could not find the IIFE close to inject into");

const out = withFonts.slice(0, at) + "\n" + EXPOSE + withFonts.slice(at);
await writeFile(dir + "prototype-harness.html", out);
console.log("Wrote reference/prototype-harness.html");
