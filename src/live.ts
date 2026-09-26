/**
 * The live timer.
 *
 * Time comes from performance.now via an anchor rather than by accumulating
 * frame deltas, so the clock stays correct even when rAF is throttled in a
 * background tab or the render is hogging the main thread.
 *
 * No React, no DOM beyond the wake lock and the document title. The UI
 * subscribes and re-renders itself.
 */
import { BellPlayer } from "./bell";
import type { Settings } from "./settings";
import {
  fmtClock,
  labelFor,
  secondsShown,
  segIndexAt,
  stateAt,
  type Timeline,
} from "./timeline";

export interface TimerSnapshot {
  /** Seconds from the start of the session. */
  position: number;
  running: boolean;
  finished: boolean;
}

type Listener = (snapshot: TimerSnapshot) => void;

const IDLE_TITLE = "Pomodoro timer and overlay maker";

export class LiveTimer {
  private tl: Timeline;
  private settings: Settings;
  private bell = new BellPlayer();

  private paused = 0;
  private anchorAt = 0;
  private anchorPos = 0;
  private isRunning = false;
  private lastSeg = 0;

  private listeners = new Set<Listener>();
  private wakeLock: WakeLockSentinel | null = null;
  private backgroundTick: ReturnType<typeof setInterval> | null = null;

  constructor(tl: Timeline, settings: Settings) {
    this.tl = tl;
    this.settings = settings;
  }

  private now(): number {
    return performance.now() / 1000;
  }

  get position(): number {
    return this.isRunning
      ? Math.min(this.tl.total, this.anchorPos + (this.now() - this.anchorAt))
      : this.paused;
  }

  get running(): boolean {
    return this.isRunning;
  }

  get finished(): boolean {
    return !this.isRunning && this.paused >= this.tl.total && this.tl.total > 0;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snapshot: TimerSnapshot = {
      position: this.position,
      running: this.isRunning,
      finished: this.finished,
    };
    for (const fn of this.listeners) fn(snapshot);
  }

  /** Swap in a new timeline, keeping the playhead where it was if possible. */
  setTimeline(tl: Timeline): void {
    const p = Math.min(this.position, tl.total);
    this.tl = tl;
    this.seek(p);
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
  }

  seek(to: number): void {
    const p = Math.max(0, Math.min(this.tl.total, to));
    if (this.isRunning) {
      this.anchorPos = p;
      this.anchorAt = this.now();
    } else {
      this.paused = p;
    }
    this.lastSeg = segIndexAt(this.tl, p);
    this.emit();
  }

  start(): void {
    // Must happen inside the click that called start, or audio stays blocked.
    this.bell.unlock();
    if (this.paused >= this.tl.total) this.paused = 0;

    this.isRunning = true;
    this.anchorAt = this.now();
    this.anchorPos = this.paused;
    this.lastSeg = segIndexAt(this.tl, this.paused);

    // Starting exactly on a segment boundary should chime.
    const st = stateAt(this.tl, this.paused);
    if (st.seg && st.seg.kind !== "lead" && st.local < 0.5) this.ring();

    void this.acquireWakeLock();
    this.startBackgroundTick();
    this.emit();
  }

  pause(): void {
    this.paused = this.position;
    this.isRunning = false;
    this.releaseWakeLock();
    this.stopBackgroundTick();
    this.setTitle(IDLE_TITLE);
    this.emit();
  }

  reset(): void {
    this.isRunning = false;
    this.paused = 0;
    this.lastSeg = 0;
    this.releaseWakeLock();
    this.stopBackgroundTick();
    this.setTitle(IDLE_TITLE);
    this.emit();
  }

  /** Jump to the start of the next segment. */
  skip(): void {
    const i = segIndexAt(this.tl, this.position);
    const next = this.tl.segs[i + 1];
    const target = next ? next.start : this.tl.total;
    const wasRunning = this.isRunning;
    this.seek(target);
    if (wasRunning && next && next.kind !== "lead") this.ring();
  }

  private ring(): void {
    if (this.settings.sound) this.bell.ring();
  }

  /**
   * Advance bells and the title. Called from the UI's animation frame while
   * visible, and from a timer while the tab is hidden.
   */
  tick(): void {
    if (!this.isRunning) return;
    const p = this.position;

    const i = segIndexAt(this.tl, p);
    if (i !== this.lastSeg) {
      if (i > this.lastSeg && this.tl.segs[i].kind !== "lead") this.ring();
      this.lastSeg = i;
    }

    if (p >= this.tl.total) {
      this.isRunning = false;
      this.paused = this.tl.total;
      const last = this.tl.segs[this.tl.segs.length - 1];
      // If there is an end screen it already chimed when it began.
      if (!last || last.kind !== "done") this.ring();
      this.releaseWakeLock();
      this.stopBackgroundTick();
      this.setTitle("Session complete");
      this.emit();
      return;
    }

    const st = stateAt(this.tl, p);
    this.setTitle(
      `${fmtClock(secondsShown(st, this.settings.direction), this.tl.hours)} ` +
        labelFor(st.seg.kind, this.settings)
    );
    this.emit();
  }

  private setTitle(title: string): void {
    if (typeof document !== "undefined") document.title = title;
  }

  /* ---------- background tab ---------- */

  // rAF stops in a hidden tab, so bells and the title would stall. A coarse
  // interval keeps them going; the clock itself is derived from the anchor and
  // needs no help.
  private startBackgroundTick(): void {
    if (this.backgroundTick) return;
    this.backgroundTick = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) this.tick();
    }, 250);
  }

  private stopBackgroundTick(): void {
    if (this.backgroundTick) clearInterval(this.backgroundTick);
    this.backgroundTick = null;
  }

  /* ---------- wake lock ---------- */

  /** Stop the screen sleeping mid focus block. Unsupported browsers no-op. */
  private async acquireWakeLock(): Promise<void> {
    try {
      if (!("wakeLock" in navigator) || this.wakeLock) return;
      this.wakeLock = await navigator.wakeLock.request("screen");
      // The lock is dropped whenever the tab is hidden, so it has to be retaken.
      this.wakeLock.addEventListener("release", () => {
        this.wakeLock = null;
      });
    } catch {
      this.wakeLock = null;
    }
  }

  private releaseWakeLock(): void {
    try {
      void this.wakeLock?.release();
    } catch {
      // already gone
    }
    this.wakeLock = null;
  }

  /** Call when the tab becomes visible again to retake a dropped lock. */
  onVisible(): void {
    if (this.isRunning) void this.acquireWakeLock();
  }

  destroy(): void {
    this.releaseWakeLock();
    this.stopBackgroundTick();
    this.bell.close();
    this.listeners.clear();
  }
}
