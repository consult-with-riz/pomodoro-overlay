/**
 * The session model: turning settings into a list of segments, and answering
 * what is on screen at time t.
 *
 * Pure. No DOM, no React. The export loop and the live timer both read from
 * here, so this file decides what every frame says.
 */
import type { Settings } from "./settings";

export type SegmentKind = "lead" | "focus" | "break" | "done";

export interface Segment {
  kind: SegmentKind;
  /** Seconds. */
  dur: number;
  /** Seconds from the start of the session. */
  start: number;
  round: number;
}

export interface Timeline {
  segs: Segment[];
  /** Total session length in seconds. */
  total: number;
  rounds: number;
  /** True when any segment runs an hour or more, so clocks need an hours field. */
  hours: boolean;
}

export interface TimelineState {
  seg: Segment;
  i: number;
  /** Seconds elapsed within the current segment. */
  local: number;
  t: number;
}

export function clampInt(
  value: unknown,
  lo: number,
  hi: number,
  fallback: number
): number {
  let n = Math.round(Number(value));
  if (!Number.isFinite(n)) n = fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function buildTimeline(s: Settings): Timeline {
  const focus = clampInt(s.focusMin, 1, 240, 50) * 60;
  const brk = clampInt(s.breakMin, 0, 120, 10) * 60;
  const rounds = clampInt(s.rounds, 1, 12, 1);
  const lead = clampInt(s.leadSec, 0, 600, 0);
  const outro = clampInt(s.outroSec, 0, 120, 0);

  const segs: Segment[] = [];
  let t = 0;
  const push = (kind: SegmentKind, dur: number, round: number) => {
    segs.push({ kind, dur, start: t, round });
    t += dur;
  };

  if (lead > 0) push("lead", lead, 1);
  for (let r = 1; r <= rounds; r++) {
    push("focus", focus, r);
    // The last break is only kept when the session is meant to end on one.
    if (brk > 0 && (r < rounds || s.endWithBreak)) push("break", brk, r);
  }
  if (outro > 0) push("done", outro, rounds);

  const longest = segs.reduce((m, g) => Math.max(m, g.dur), 0);
  return { segs, total: t, rounds, hours: longest >= 3600 };
}

export function segIndexAt(tl: Timeline, t: number): number {
  for (let i = tl.segs.length - 1; i >= 0; i--) {
    if (t >= tl.segs[i].start) return i;
  }
  return 0;
}

export function stateAt(tl: Timeline, t: number): TimelineState {
  t = Math.max(0, Math.min(t, tl.total));
  let i = segIndexAt(tl, t);
  if (t >= tl.total && tl.segs.length) i = tl.segs.length - 1;
  const seg = tl.segs[i];
  const local = Math.min(seg.dur, t - seg.start);
  return { seg, i, local, t };
}

/** The countdown or count-up reading, in seconds, for a given state. */
export function secondsShown(
  st: TimelineState,
  direction: Settings["direction"]
): number {
  if (st.seg.kind === "done") return 0;
  return direction === "up"
    ? Math.floor(st.local)
    : st.seg.dur - Math.floor(st.local);
}

/** The label for a segment, given the user's wording. */
export function labelFor(kind: SegmentKind, s: Settings): string {
  return kind === "focus"
    ? s.labelFocus
    : kind === "break"
      ? s.labelBreak
      : kind === "lead"
        ? s.labelLead
        : s.labelDone;
}

/** mm:ss, or h:mm:ss when the session needs an hours field. */
export function fmtClock(sec: number, hours: boolean): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return hours ? `${h}:${p(m)}:${p(s)}` : `${p(m + h * 60)}:${p(s)}`;
}

/** Human duration for the UI: 4:08, or 1:04:08 past an hour. */
export function fmtLen(sec: number): string {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
