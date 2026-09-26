/**
 * The renderer. One pure function draws one frame.
 *
 * The preview and the export both call drawFrame, which is what makes the
 * preview honest — what is on screen is what lands in the file. It must stay
 * free of DOM, React and module state, and resolution-independent: every
 * measurement derives from H, so 720p and 4K differ only in pixel count.
 *
 * Transcribed from the prototype. The golden frames in tests/golden/ were
 * captured from that original, so any change here has to be deliberate.
 */
import {
  FONTS,
  SCREEN,
  type Background,
  type Settings,
} from "./settings";
import {
  fmtClock,
  labelFor,
  stateAt,
  type Timeline,
} from "./timeline";

/* ---------- colour ---------- */

export function hexToRgb(hex: string): [number, number, number] {
  let h = String(hex ?? "#ffffff").replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(
    A[0] + (B[0] - A[0]) * t,
    A[1] + (B[1] - A[1]) * t,
    A[2] + (B[2] - A[2]) * t
  );
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Hue 0-360, saturation and lightness 0-1. Used for the keying warnings. */
export function hsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h =
      mx === r
        ? (g - b) / d + (g < b ? 6 : 0)
        : mx === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

/* ---------- text ---------- */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Font = (typeof FONTS)[keyof typeof FONTS];

/**
 * Draw a clock with every digit on the same advance width.
 *
 * Proportional digits make the timer jitter as the numbers change, so each
 * glyph is centred in a cell as wide as the widest digit. The colon gets its
 * own narrower cell and sits fractionally high.
 */
function drawTime(
  ctx: Ctx,
  str: string,
  x: number,
  y: number,
  size: number,
  font: Font,
  color: string,
  align: "left" | "right" | "center"
): number {
  ctx.font = `${font.num} ${size}px ${font.family}`;
  let dw = 0;
  for (let d = 0; d <= 9; d++) {
    dw = Math.max(dw, ctx.measureText(String(d)).width);
  }
  const cw = ctx.measureText(":").width * 1.05;
  let total = 0;
  for (const ch of str) total += ch === ":" ? cw : dw;

  let cx = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const ch of str) {
    const w = ch === ":" ? cw : dw;
    ctx.fillText(ch, cx + w / 2, ch === ":" ? y - size * 0.04 : y);
    cx += w;
  }
  return total;
}

function timeWidth(ctx: Ctx, str: string, size: number, font: Font): number {
  ctx.font = `${font.num} ${size}px ${font.family}`;
  let dw = 0;
  for (let d = 0; d <= 9; d++) {
    dw = Math.max(dw, ctx.measureText(String(d)).width);
  }
  const cw = ctx.measureText(":").width * 1.05;
  let total = 0;
  for (const ch of str) total += ch === ":" ? cw : dw;
  return total;
}

function fitTime(
  ctx: Ctx,
  str: string,
  size: number,
  font: Font,
  maxW: number
): number {
  const w = timeWidth(ctx, str, size, font);
  return w > maxW ? (size * maxW) / w : size;
}

function fitText(
  ctx: Ctx,
  text: string,
  weight: number,
  size: number,
  family: string,
  maxW: number
): number {
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  return w > maxW ? (size * maxW) / w : size;
}

function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- frame ---------- */

/**
 * Draw the overlay for time `t` into a context of size W x H.
 *
 * `mode` is the background treatment, kept separate from settings.bg so the
 * preview can draw transparent over a CSS-coloured stage while the export
 * paints the real screen colour.
 */
export function drawFrame(
  ctx: Ctx,
  W: number,
  H: number,
  tl: Timeline,
  t: number,
  s: Settings,
  mode: Background
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const screen = mode === "green" || mode === "blue";
  if (screen) {
    ctx.fillStyle = SCREEN[mode];
    ctx.fillRect(0, 0, W, H);
  }
  if (!tl.segs.length) {
    ctx.restore();
    return;
  }

  const st = stateAt(tl, t);
  const seg = st.seg;
  const font = FONTS[s.font] ?? FONTS.bsd;
  const text = s.textColor;
  const accent =
    seg.kind === "focus"
      ? s.focusColor
      : seg.kind === "break"
        ? s.breakColor
        : seg.kind === "done"
          ? s.focusColor
          : mix(text, "#808080", 0.35);
  const label = labelFor(seg.kind, s);
  const roundTxt =
    s.showRound && tl.rounds > 1 && (seg.kind === "focus" || seg.kind === "break")
      ? `Round ${seg.round} of ${tl.rounds}`
      : "";

  let secs: number;
  let frac: number;
  if (seg.kind === "done") {
    secs = 0;
    frac = 1;
  } else if (s.direction === "up") {
    secs = Math.floor(st.local);
    frac = seg.dur ? st.local / seg.dur : 0;
  } else {
    secs = seg.dur - Math.floor(st.local);
    frac = seg.dur ? 1 - st.local / seg.dur : 0;
  }
  const clock = fmtClock(secs, tl.hours);

  const plateOn = s.plate !== "none";
  const plateCol =
    s.plate === "light"
      ? screen
        ? "#F3F5F2"
        : "rgba(246,248,245,0.84)"
      : screen
        ? "#111614"
        : "rgba(10,14,12,0.62)";
  const plateSolid = s.plate === "light" ? "#F3F5F2" : "#111614";

  // On a keyed background everything has to stay opaque, so "softening" a
  // colour means mixing toward the plate instead of lowering alpha. A
  // semi-transparent pixel keys out as a fringe.
  const soft = (c: string, amt: number) =>
    screen ? mix(c, plateOn ? plateSolid : "#000000", amt) : rgba(c, 1 - amt);
  const track = screen
    ? mix(text, plateOn ? plateSolid : "#000000", plateOn ? 0.8 : 0.62)
    : rgba(text, 0.22);

  const size = Math.max(40, (H * (Number(s.scale) || 34)) / 100);
  const margin = H * 0.055;
  const pad = plateOn ? size * 0.1 : 0;

  // Measure the content box for the chosen style.
  let bw: number;
  let bh: number;
  if (s.style === "bar") {
    bw = size * 2.3;
    bh = size * (s.showLabel || roundTxt ? 0.82 : 0.66);
  } else if (s.style === "digits") {
    const ts = fitTime(ctx, clock, size * 0.46, font, size * 3);
    bw = Math.max(
      timeWidth(ctx, tl.hours ? "0:00:00" : "00:00", ts, font),
      size * 0.8
    );
    bh = size * (s.showLabel || roundTxt ? 0.72 : 0.52);
  } else {
    bw = size;
    bh = size;
  }

  const boxW = bw + pad * 2;
  const boxH = bh + pad * 2;
  const col = s.pos[1];
  const row = s.pos[0];
  const x0 = col === "l" ? margin : col === "r" ? W - margin - boxW : (W - boxW) / 2;
  const y0 = row === "t" ? margin : row === "b" ? H - margin - boxH : (H - boxH) / 2;
  const align = col === "l" ? "left" : col === "r" ? "right" : "center";

  if (plateOn) {
    ctx.fillStyle = plateCol;
    roundRect(ctx, x0, y0, boxW, boxH, s.style === "ring" ? boxW / 2 : size * 0.12);
    ctx.fill();
  }
  // A shadow can't be keyed cleanly, so it is only ever drawn on transparent
  // output with no plate behind it.
  if (s.shadow && mode === "transparent" && !plateOn) {
    ctx.shadowColor = "rgba(0,0,0,0.38)";
    ctx.shadowBlur = size * 0.05;
    ctx.shadowOffsetY = size * 0.012;
  }

  const cx0 = x0 + pad;
  const cy0 = y0 + pad;

  if (s.style === "ring") {
    const cx = cx0 + size / 2;
    const cy = cy0 + size / 2;
    const stroke = size * 0.058;
    const r = size / 2 - stroke / 2;

    ctx.lineCap = "round";
    ctx.lineWidth = stroke;
    ctx.strokeStyle = track;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (frac > 0.0005) {
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac));
      ctx.stroke();
    }

    const inner = (r - stroke) * 2;
    const ts = fitTime(ctx, clock, size * (tl.hours ? 0.21 : 0.27), font, inner * 0.84);
    const hasTop = s.showLabel && !!label;
    const hasBot = !!roundTxt;
    // Nudge the clock when only one of the two side texts is present, so the
    // block stays optically centred in the ring.
    const dy = hasTop && !hasBot ? size * 0.035 : !hasTop && hasBot ? -size * 0.03 : 0;

    drawTime(ctx, clock, cx, cy + dy, ts, font, text, "center");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (hasTop) {
      const ls = fitText(ctx, label, font.lab, size * 0.078, font.family, inner * 0.7);
      ctx.font = `${font.lab} ${ls}px ${font.family}`;
      ctx.fillStyle = accent;
      ctx.fillText(label, cx, cy + dy - ts * 0.62 - ls * 0.35);
    }
    if (hasBot) {
      const rs = fitText(ctx, roundTxt, font.lab, size * 0.058, font.family, inner * 0.66);
      ctx.font = `${font.lab} ${rs}px ${font.family}`;
      ctx.fillStyle = soft(text, 0.3);
      ctx.fillText(roundTxt, cx, cy + dy + ts * 0.62 + rs * 0.4);
    }
  } else if (s.style === "bar") {
    const topRow = s.showLabel || !!roundTxt;
    const labS = size * 0.1;
    let y = cy0;
    ctx.textBaseline = "middle";

    if (topRow) {
      y += labS * 0.6;
      if (s.showLabel && label) {
        ctx.font = `${font.lab} ${fitText(ctx, label, font.lab, labS, font.family, bw * (roundTxt ? 0.55 : 1))}px ${font.family}`;
        ctx.fillStyle = accent;
        ctx.textAlign = align === "right" && !roundTxt ? "right" : "left";
        ctx.fillText(label, align === "right" && !roundTxt ? cx0 + bw : cx0, y);
      }
      if (roundTxt) {
        ctx.font = `${font.lab} ${labS * 0.8}px ${font.family}`;
        ctx.fillStyle = soft(text, 0.3);
        ctx.textAlign = "right";
        ctx.fillText(roundTxt, cx0 + bw, y);
      }
      y += labS * 0.6;
    }

    const barH = size * 0.05;
    const timeSpace = cy0 + bh - barH - size * 0.06 - y;
    const ts = fitTime(ctx, clock, Math.min(timeSpace * 1.02, size * 0.5), font, bw);
    const tAlign = align === "center" ? "center" : align;
    const tx = tAlign === "left" ? cx0 : tAlign === "right" ? cx0 + bw : cx0 + bw / 2;
    drawTime(ctx, clock, tx, y + timeSpace / 2 + size * 0.01, ts, font, text, tAlign);

    const by = cy0 + bh - barH;
    // The bar itself never takes the shadow; it would smear along the track.
    ctx.shadowColor = "transparent";
    ctx.fillStyle = track;
    roundRect(ctx, cx0, by, bw, barH, barH / 2);
    ctx.fill();
    if (frac > 0.0005) {
      ctx.fillStyle = accent;
      roundRect(ctx, cx0, by, Math.max(barH, bw * Math.min(1, frac)), barH, barH / 2);
      ctx.fill();
    }
  } else {
    const hasBot = (s.showLabel && !!label) || !!roundTxt;
    const ts = fitTime(ctx, clock, size * 0.46, font, bw);
    const tAlign = align;
    const tx = tAlign === "left" ? cx0 : tAlign === "right" ? cx0 + bw : cx0 + bw / 2;
    const timeH = hasBot ? bh * 0.72 : bh;
    drawTime(ctx, clock, tx, cy0 + timeH / 2, ts, font, text, tAlign);
    if (hasBot) {
      const parts = [s.showLabel ? label : "", roundTxt].filter(Boolean).join("   ");
      const ls = fitText(ctx, parts, font.lab, size * 0.085, font.family, bw);
      ctx.font = `${font.lab} ${ls}px ${font.family}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = tAlign;
      ctx.fillStyle = accent;
      ctx.fillText(parts, tx, cy0 + timeH + (bh - timeH) / 2);
    }
  }

  ctx.restore();
}
