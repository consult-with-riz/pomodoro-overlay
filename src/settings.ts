/**
 * Settings shape, defaults and the lookup tables the renderer draws from.
 *
 * Values match the prototype exactly. The goldens were captured from them, so
 * changing a default changes what the tests compare against.
 */

import type { BellVariant } from "./bell";
import type { NoiseKind } from "./noise";

export type Style = "ring" | "bar" | "digits";
export type FontKey = "bsd" | "grotesk" | "mono" | "serif";
export type Plate = "none" | "light" | "dark";
export type Background = "green" | "blue" | "black" | "transparent";
export type Direction = "up" | "down";
export type Resolution = "720" | "1080" | "2160";

/** Row then column: "tr" is top right, "mc" is centred. */
export type Position =
  | "tl" | "tc" | "tr"
  | "ml" | "mc" | "mr"
  | "bl" | "bc" | "br";

export interface Settings {
  focusMin: number;
  breakMin: number;
  rounds: number;
  endWithBreak: boolean;
  leadSec: number;
  outroSec: number;
  direction: Direction;
  labelFocus: string;
  labelBreak: string;
  labelLead: string;
  labelDone: string;
  showLabel: boolean;
  showRound: boolean;
  style: Style;
  font: FontKey;
  textColor: string;
  focusColor: string;
  breakColor: string;
  plate: Plate;
  shadow: boolean;
  scale: number;
  pos: Position;
  bg: Background;
  res: Resolution;
  fps: string;
  bell: boolean;
  /** Which sound plays at each switch, in the live preview and the file. */
  bellSound: BellVariant;
  /** Ambient bed mixed into the exported audio. Silent by default. */
  noise: NoiseKind;
  noiseVolume: number;
  sound: boolean;
}

export const DEFAULTS: Settings = {
  focusMin: 50,
  breakMin: 10,
  rounds: 1,
  endWithBreak: true,
  leadSec: 10,
  outroSec: 5,
  direction: "down",
  labelFocus: "Focus",
  labelBreak: "Break",
  labelLead: "Get ready",
  labelDone: "Session complete",
  showLabel: true,
  showRound: true,
  style: "ring",
  font: "bsd",
  textColor: "#ffffff",
  focusColor: "#ff5a3c",
  breakColor: "#7fb8ff",
  plate: "none",
  shadow: true,
  scale: 34,
  pos: "tr",
  bg: "green",
  res: "1080",
  fps: "10",
  bell: true,
  bellSound: "bell",
  noise: "none",
  noiseVolume: 0.3,
  sound: true,
};

export interface FontSpec {
  /** CSS family name, quoted because the names contain spaces. */
  family: string;
  /** Weight for the digits. */
  num: number;
  /** Weight for the labels. */
  lab: number;
}

export const FONTS: Record<FontKey, FontSpec> = {
  bsd: { family: '"Big Shoulders Display"', num: 800, lab: 600 },
  grotesk: { family: '"Schibsted Grotesk"', num: 700, lab: 500 },
  mono: { family: '"JetBrains Mono"', num: 700, lab: 500 },
  serif: { family: '"Instrument Serif"', num: 400, lab: 400 },
};

export const RES: Record<Resolution, [number, number]> = {
  "720": [1280, 720],
  "1080": [1920, 1080],
  "2160": [3840, 2160],
};

/**
 * Opaque backgrounds the overlay can be laid on.
 *
 * Green and blue are the broadcast chroma key colours. Black is not keyed at
 * all — editors drop it with a Screen blend mode, which needs no settings and
 * leaves no coloured fringe, so it suits footage that already contains a lot
 * of green or blue.
 */
export const SCREEN: Record<"green" | "blue" | "black", string> = {
  green: "#00B140",
  blue: "#0047BB",
  black: "#000000",
};

/**
 * Which format each editor can actually open.
 *
 * "Green MP4 / Blue MP4 / Transparent" is a question about codecs. The
 * question people can answer is what they edit in — and getting it wrong is
 * expensive, because Premiere and Final Cut cannot import VP9-with-alpha WebM
 * at all. Someone picks Transparent because it sounds best, waits out the
 * render, and their editor refuses the file.
 */
export interface EditorTarget {
  id: string;
  label: string;
  bg: Background;
  why: string;
}

export const EDITORS: EditorTarget[] = [
  {
    id: "premiere",
    label: "Adobe Premiere Pro",
    bg: "green",
    why: "Premiere can't import WebM with alpha, so this uses a green screen MP4 you key with Ultra Key.",
  },
  {
    id: "finalcut",
    label: "Final Cut Pro",
    bg: "green",
    why: "Final Cut can't import WebM with alpha, so this uses a green screen MP4 you key with Keyer.",
  },
  {
    id: "davinci",
    label: "DaVinci Resolve",
    bg: "transparent",
    why: "Resolve reads WebM with alpha, so the overlay arrives already transparent — no keying needed.",
  },
  {
    id: "obs",
    label: "OBS Studio",
    bg: "transparent",
    why: "OBS reads WebM with alpha, so you can drop it straight in as a media source.",
  },
  {
    id: "capcut",
    label: "CapCut",
    bg: "green",
    why: "Green screen MP4 is the safe choice here; use CapCut's Chroma key to remove it.",
  },
  {
    id: "screen",
    label: "I'll use a Screen blend mode",
    bg: "black",
    why: "Black drops out under a Screen blend in any editor, with no keying and no coloured fringe.",
  },
];

export const STORE_KEY = "pomodoro-overlay-settings-v1";

/**
 * One-click looks.
 *
 * Most people do not want to design a timer, they want to pick one. Presets
 * only set values — every individual control stays available, and changing
 * one simply deselects the preset.
 */
export interface StylePreset {
  id: string;
  label: string;
  hint: string;
  apply: Partial<Settings>;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "minimal",
    label: "Minimal",
    hint: "Small ring, no card, out of the way.",
    apply: {
      style: "ring",
      font: "grotesk",
      plate: "none",
      scale: 24,
      showLabel: false,
      showRound: false,
      textColor: "#ffffff",
    },
  },
  {
    id: "bold",
    label: "Bold",
    hint: "Big digits on a dark card.",
    apply: {
      style: "digits",
      font: "bsd",
      plate: "dark",
      scale: 40,
      showLabel: true,
      showRound: true,
      textColor: "#ffffff",
    },
  },
  {
    id: "broadcast",
    label: "Broadcast",
    hint: "Lower-third bar with a progress track.",
    apply: {
      style: "bar",
      font: "grotesk",
      plate: "dark",
      scale: 30,
      pos: "bl",
      showLabel: true,
      showRound: true,
      textColor: "#ffffff",
    },
  },
];

/** Settings that change the shape of the timeline rather than just its look. */
export const SESSION_KEYS = new Set<keyof Settings>([
  "focusMin",
  "breakMin",
  "rounds",
  "endWithBreak",
  "leadSec",
  "outroSec",
]);

export function loadSettings(): Settings {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULTS, ...saved };
  } catch {
    // corrupt or blocked storage is not worth failing over
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    // private mode, quota, blocked storage
  }
}
