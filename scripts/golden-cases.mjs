/**
 * The frames the rewrite has to reproduce.
 *
 * Base session is the one CLAUDE.md specifies for the ffprobe test:
 * 3s lead + (60s focus + 60s break) x 2 + 5s outro = 248s total.
 * Reusing it means the golden frames and the video test describe the same
 * session, so a failure points at one timeline rather than two.
 */
export const BASE = {
  focusMin: 1,
  breakMin: 1,
  rounds: 2,
  endWithBreak: true,
  leadSec: 3,
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
  shadow: false,
  scale: 34,
  pos: "tr",
  bg: "green",
  res: "720",
  fps: "10",
  bell: true,
  sound: true,
};

export const WIDTH = 1280;
export const HEIGHT = 720;

/**
 * Each case pins one axis of the drawing surface. `t` values are chosen to land
 * inside a specific segment:
 *   t=1   lead        t=5   focus r1 (reads 00:58)
 *   t=65  break r1    t=130 focus r2
 *   t=246 done
 */
export const CASES = [
  // Segment coverage, everything else at defaults.
  { name: "seg-lead-t1", t: 1 },
  { name: "seg-focus-t5", t: 5 },
  { name: "seg-break-t65", t: 65 },
  { name: "seg-focus-r2-t130", t: 130 },
  { name: "seg-done-t246", t: 246 },

  // Styles.
  { name: "style-bar-t5", t: 5, settings: { style: "bar" } },
  { name: "style-digits-t5", t: 5, settings: { style: "digits" } },

  // Fonts. Each is a different family and weight pair, so a font that fails to
  // load shows up here rather than silently in the export.
  { name: "font-grotesk-t5", t: 5, settings: { font: "grotesk" } },
  { name: "font-mono-t5", t: 5, settings: { font: "mono" } },
  { name: "font-serif-t5", t: 5, settings: { font: "serif" } },

  // Background modes. Transparent is the one that can regress silently.
  { name: "bg-blue-t5", t: 5, settings: { bg: "blue" } },
  { name: "bg-transparent-t5", t: 5, settings: { bg: "transparent", shadow: true } },

  // Plate, position and scale.
  { name: "plate-dark-t5", t: 5, settings: { plate: "dark" } },
  { name: "plate-light-t5", t: 5, settings: { plate: "light" } },
  { name: "pos-bl-scale60-t5", t: 5, settings: { pos: "bl", scale: 60 } },

  // Count-up rather than count-down, and labels off.
  { name: "direction-up-t5", t: 5, settings: { direction: "up" } },
  { name: "labels-off-t5", t: 5, settings: { showLabel: false, showRound: false } },
];

export function settingsFor(testCase) {
  return { ...BASE, ...(testCase.settings ?? {}) };
}
