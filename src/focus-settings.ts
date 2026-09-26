/**
 * Settings for the focus timer.
 *
 * Deliberately a separate store from the overlay maker's. The two are
 * different products sharing an engine, and someone who set up a green screen
 * for a video should not find their workspace turned green.
 */
import type { BellVariant } from "./bell";
import type { NoiseKind } from "./noise";

export interface Preset {
  id: string;
  label: string;
  focusMin: number;
  breakMin: number;
  rounds: number;
}

/**
 * Three presets, not a form. The numbers are still editable underneath, but
 * nobody should have to configure anything to start working.
 */
export const PRESETS: Preset[] = [
  { id: "classic", label: "25 / 5", focusMin: 25, breakMin: 5, rounds: 4 },
  { id: "long", label: "50 / 10", focusMin: 50, breakMin: 10, rounds: 2 },
  { id: "deep", label: "90 / 15", focusMin: 90, breakMin: 15, rounds: 1 },
];

export type ThemeId = "warm" | "slate" | "forest" | "dusk";

export interface Phase {
  /** Two stops for the page gradient. */
  from: string;
  to: string;
  /** Ink and the ring's progress colour for this phase. */
  ink: string;
  accent: string;
}

export interface Theme {
  id: ThemeId;
  label: string;
  focus: Phase;
  break: Phase;
  lead: Phase;
  done: Phase;
}

/**
 * The background follows the phase rather than being decoration.
 *
 * Focus states are cooler and darker — less to look at. Break states lift in
 * warmth and brightness, so stepping away actually feels different from
 * working. That change of state is the point; the colours are secondary.
 */
export const THEMES: Record<ThemeId, Theme> = {
  warm: {
    id: "warm",
    label: "Warm",
    focus: { from: "#F1EBDE", to: "#E4DACA", ink: "#22332C", accent: "#FF5C35" },
    break: { from: "#FFF3DF", to: "#FFE2BC", ink: "#3A2A18", accent: "#E8431B" },
    lead: { from: "#EDE7DB", to: "#DED6C6", ink: "#4A554E", accent: "#8C9A91" },
    done: { from: "#E8F0E4", to: "#D2E3CD", ink: "#1F4432", accent: "#1F6B4A" },
  },
  slate: {
    id: "slate",
    label: "Slate",
    focus: { from: "#12140F", to: "#1C2119", ink: "#F1EBDE", accent: "#FF6E48" },
    break: { from: "#1B2430", to: "#25384A", ink: "#E8F1F8", accent: "#6FB6FF" },
    lead: { from: "#151712", to: "#1A1D17", ink: "#A7B0A4", accent: "#6E786D" },
    done: { from: "#11201A", to: "#1B3327", ink: "#CFE8D9", accent: "#7CC8A2" },
  },
  forest: {
    id: "forest",
    label: "Forest",
    focus: { from: "#10231A", to: "#163324", ink: "#DCEDE1", accent: "#6FD39B" },
    break: { from: "#1E3A2A", to: "#2C5840", ink: "#E9F7EE", accent: "#A8E6C1" },
    lead: { from: "#132A20", to: "#193527", ink: "#9FBCA9", accent: "#5E8C72" },
    done: { from: "#173626", to: "#21503A", ink: "#E3F6E9", accent: "#8BE0AE" },
  },
  dusk: {
    id: "dusk",
    label: "Dusk",
    focus: { from: "#1B1630", to: "#2A1F45", ink: "#EDE6FF", accent: "#FF8A5B" },
    break: { from: "#3A2350", to: "#57306B", ink: "#FBEEFF", accent: "#FFB27A" },
    lead: { from: "#181428", to: "#241C3A", ink: "#A79DC4", accent: "#6E6390" },
    done: { from: "#221A3C", to: "#37285C", ink: "#F0E9FF", accent: "#C4A6FF" },
  },
};

export interface FocusSettings {
  presetId: string;
  focusMin: number;
  breakMin: number;
  rounds: number;
  /** What the session is for. Shown on screen; never leaves the browser. */
  task: string;
  theme: ThemeId;
  /** Slow drift on the background gradient. */
  motion: boolean;
  bell: BellVariant;
  bellVolume: number;
  noise: NoiseKind;
  noiseVolume: number;
  /** Count elapsed rather than remaining. */
  countUp: boolean;
}

export const FOCUS_DEFAULTS: FocusSettings = {
  presetId: "classic",
  focusMin: 25,
  breakMin: 5,
  rounds: 4,
  task: "",
  theme: "warm",
  motion: true,
  bell: "bell",
  bellVolume: 0.8,
  noise: "none",
  noiseVolume: 0.35,
  countUp: false,
};

export const FOCUS_STORE_KEY = "pomodoro-focus-settings-v1";
const SESSION_KEY = "pomodoro-focus-session-v1";

export function loadFocusSettings(): FocusSettings {
  if (typeof localStorage === "undefined") return { ...FOCUS_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(FOCUS_STORE_KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...FOCUS_DEFAULTS, ...saved };
  } catch {
    // blocked or corrupt storage is not worth failing over
  }
  return { ...FOCUS_DEFAULTS };
}

export function saveFocusSettings(s: FocusSettings): void {
  try {
    localStorage.setItem(FOCUS_STORE_KEY, JSON.stringify(s));
  } catch {
    // private mode, quota
  }
}

/**
 * A session in progress, anchored to the wall clock.
 *
 * Losing a 40 minute focus block to an accidental refresh is the worst thing
 * this app could do to someone, so the running position is written out and
 * restored. performance.now() resets on reload, hence Date.now().
 */
export interface StoredSession {
  position: number;
  running: boolean;
  /** Date.now() when `position` was recorded. */
  at: number;
  /** Discard a restore if the session settings no longer match. */
  signature: string;
}

export function sessionSignature(s: FocusSettings): string {
  return `${s.focusMin}-${s.breakMin}-${s.rounds}`;
}

export function saveSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/**
 * Recover a session, advancing it by however long the page was away.
 * Returns null when there is nothing worth restoring.
 */
export function loadSession(settings: FocusSettings, total: number): StoredSession | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const stored = raw as StoredSession;
    if (stored.signature !== sessionSignature(settings)) return null;

    const elapsed = stored.running ? (Date.now() - stored.at) / 1000 : 0;
    const position = Math.min(total, stored.position + elapsed);
    if (position <= 0 || position >= total) return null;

    return { ...stored, position };
  } catch {
    return null;
  }
}
