/**
 * Settings shape, defaults and the lookup tables the renderer draws from.
 *
 * Values match the prototype exactly. The goldens were captured from them, so
 * changing a default changes what the tests compare against.
 */

export type Style = "ring" | "bar" | "digits";
export type FontKey = "bsd" | "grotesk" | "mono" | "serif";
export type Plate = "none" | "light" | "dark";
export type Background = "green" | "blue" | "transparent";
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

/** Broadcast chroma key colours. */
export const SCREEN: Record<"green" | "blue", string> = {
  green: "#00B140",
  blue: "#0047BB",
};

export const STORE_KEY = "pomodoro-overlay-settings-v1";

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
