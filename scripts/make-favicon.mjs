/**
 * Render app/icon.svg into app/favicon.ico.
 *
 * Next declares the SVG icon in the head, which modern browsers use, but they
 * still probe /favicon.ico and some crawlers only look there. Shipping a real
 * one keeps the console clean and the tab icon correct everywhere.
 *
 * The .ico wraps a 32x32 PNG, which every browser since Vista accepts.
 * Run with `npm run favicon` after changing the icon.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const SIZE = 32;

const svg = await readFile(root + "app/icon.svg", "utf8");

const browser = await chromium.launch();
let png;
try {
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<body style="margin:0">${svg.replace(
      /width="\d+" height="\d+"/,
      `width="${SIZE}" height="${SIZE}"`
    )}</body>`
  );
  png = await page.screenshot({ omitBackground: true });
} finally {
  await browser.close();
}

// ICONDIR: reserved, type 1 (icon), one image.
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(1, 4);

// ICONDIRENTRY: dimensions, palette and planes zeroed for PNG payloads.
const entry = Buffer.alloc(16);
entry.writeUInt8(SIZE, 0);
entry.writeUInt8(SIZE, 1);
entry.writeUInt8(0, 2); // colours in palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // colour planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(dir.length + entry.length, 12); // offset to the data

await writeFile(root + "app/favicon.ico", Buffer.concat([dir, entry, png]));
console.log(`Wrote app/favicon.ico (${SIZE}x${SIZE}, ${png.length} byte PNG payload)`);
