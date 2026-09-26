/**
 * Download and pin the four fonts the renderer draws with.
 *
 * The export path draws text into a canvas. If a face is missing the browser
 * silently substitutes a fallback and produces a video that looks fine and is
 * wrong, so the fonts ship with the app rather than loading from a CDN.
 *
 * Goldens must be captured with these exact files, not Google's CDN copies,
 * or the comparison fails on subpixel drift when Google ships a font update.
 *
 * Two things Google's CSS does that need handling:
 *  - It emits one @font-face per subset (vietnamese / latin-ext / latin), each
 *    a different file. Only latin and latin-ext are kept; the timer draws
 *    digits and short ASCII labels.
 *  - These are variable fonts, so several weights share one file. Downloads are
 *    deduped by URL while each weight keeps its own @font-face declaration, so
 *    the browser still picks the right instance off the variable axis.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { join } from "node:path";

const OUT = fileURLToPath(new URL("../public/fonts/", import.meta.url));

const FAMILIES = [
  "Big+Shoulders+Display:wght@600;800",
  "Instrument+Serif:wght@400",
  "JetBrains+Mono:wght@500;700",
  "Schibsted+Grotesk:wght@400;500;600;700",
];

const KEEP_SUBSETS = new Set(["latin", "latin-ext"]);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const cssUrl =
  "https://fonts.googleapis.com/css2?" +
  FAMILIES.map((f) => "family=" + f).join("&") +
  "&display=block";

const css = await fetch(cssUrl, { headers: { "User-Agent": UA } }).then((r) => {
  if (!r.ok) throw new Error(`Google Fonts CSS returned ${r.status}`);
  return r.text();
});

await mkdir(OUT, { recursive: true });

// Each block is preceded by a /* subset */ comment, so split on that to keep
// the subset name attached to its @font-face.
const parts = css.split(/\/\*\s*([a-z0-9-]+)\s*\*\//i).slice(1);

const files = new Map(); // url -> filename
const faces = [];

for (let i = 0; i < parts.length; i += 2) {
  const subset = parts[i];
  const block = parts[i + 1] ?? "";
  if (!KEEP_SUBSETS.has(subset)) continue;

  const family = /font-family:\s*'([^']+)'/.exec(block)?.[1];
  const weight = /font-weight:\s*([\d\s]+);/.exec(block)?.[1]?.trim();
  const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? "normal";
  const url = /src:\s*url\(([^)]+)\)/.exec(block)?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
  if (!family || !url || !weight) continue;

  if (!files.has(url)) {
    const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
    files.set(url, `${slug}-${subset}-${hash}.woff2`);
  }
  faces.push({ family, weight, style, subset, range, file: files.get(url) });
}

await Promise.all(
  [...files].map(async ([url, name]) => {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${name} returned ${res.status}`);
    await writeFile(join(OUT, name), Buffer.from(await res.arrayBuffer()));
  })
);

const out = faces
  .map(
    (f) =>
      `@font-face{font-family:'${f.family}';font-style:${f.style};` +
      `font-weight:${f.weight};font-display:block;` +
      `src:url('/fonts/${f.file}') format('woff2');` +
      (f.range ? `unicode-range:${f.range};` : "") +
      `}`
  )
  .join("\n");

await writeFile(join(OUT, "fonts.css"), out + "\n");
console.log(
  `Pinned ${files.size} font files, ${faces.length} @font-face rules to public/fonts/`
);
for (const [, name] of files) console.log("  " + name);
