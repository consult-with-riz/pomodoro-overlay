"use client";

/**
 * The focus timer.
 *
 * A different product from the overlay maker, sharing its engine. The job here
 * is a room to work in: land, press start, stop thinking about the software.
 * So there is no sidebar, nothing to configure before starting, and the chrome
 * gets out of the way once a session is running.
 *
 * Rendered as DOM and SVG rather than canvas. Canvas is the right tool for
 * exporting video; for a page it would be unreadable to a screen reader,
 * unselectable, and unable to transition between phases in CSS.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BELL_LABELS, BellPlayer, type BellVariant } from "../bell";
import { AmbientPlayer, NOISE_HINTS, NOISE_LABELS, type NoiseKind } from "../noise";
import {
  FOCUS_DEFAULTS,
  PRESETS,
  THEMES,
  clearSession,
  loadFocusSettings,
  loadSession,
  saveFocusSettings,
  saveSession,
  sessionSignature,
  type FocusSettings,
  type ThemeId,
} from "../focus-settings";
import {
  buildTimeline,
  fmtClock,
  secondsShown,
  segIndexAt,
  stateAt,
  type SegmentKind,
  type Timeline,
} from "../timeline";
import type { Settings } from "../settings";

/** How long the controls linger after the pointer stops, while running. */
const IDLE_MS = 4000;

/** The engine's settings type, filled from the focus settings. */
function toEngineSettings(s: FocusSettings): Settings {
  return {
    focusMin: s.focusMin,
    breakMin: s.breakMin,
    rounds: s.rounds,
    endWithBreak: false,
    leadSec: 0,
    outroSec: 0,
    direction: s.countUp ? "up" : "down",
    labelFocus: "Focus",
    labelBreak: "Break",
    labelLead: "Get ready",
    labelDone: "Done",
    showLabel: true,
    showRound: true,
    style: "ring",
    font: "bsd",
    textColor: "#ffffff",
    focusColor: "#ff5c35",
    breakColor: "#7fb8ff",
    plate: "none",
    shadow: false,
    scale: 34,
    pos: "mc",
    bg: "transparent",
    res: "1080",
    fps: "30",
    bell: true,
    // The focus page plays its own audio live; these only matter to the
    // exporter, which this page never reaches.
    bellSound: s.bell,
    noise: "none",
    noiseVolume: 0,
    sound: true,
  };
}

const PHASE_WORD: Record<SegmentKind, string> = {
  lead: "Get ready",
  focus: "Focus",
  break: "Break",
  done: "Done",
};

export default function Focus() {
  const [settings, setSettings] = useState<FocusSettings>(FOCUS_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [position, setPosition] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [idle, setIdle] = useState(false);

  const engine = useMemo(() => toEngineSettings(settings), [settings]);
  const timeline: Timeline = useMemo(() => buildTimeline(engine), [engine]);

  const bell = useRef<BellPlayer | null>(null);
  const ambient = useRef<AmbientPlayer | null>(null);

  // Position is driven from an anchor rather than accumulated, so throttled
  // frames in a background tab cannot make the clock drift.
  const anchorAt = useRef(0);
  const anchorPos = useRef(0);
  const lastSeg = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundRef = useRef<HTMLDivElement>(null);

  const liveSettings = useRef(settings);
  liveSettings.current = settings;
  const liveTimeline = useRef(timeline);
  liveTimeline.current = timeline;
  const liveRunning = useRef(running);
  liveRunning.current = running;

  /* ---------- settings ---------- */

  useEffect(() => {
    const loaded = loadFocusSettings();
    setSettings(loaded);
    setHydrated(true);

    // Recover a session that was interrupted by a reload.
    const tl = buildTimeline(toEngineSettings(loaded));
    const stored = loadSession(loaded, tl.total);
    if (stored) {
      anchorPos.current = stored.position;
      setPosition(stored.position);
      lastSeg.current = segIndexAt(tl, stored.position);
    }
  }, []);

  useEffect(() => {
    if (hydrated) saveFocusSettings(settings);
  }, [settings, hydrated]);

  const update = useCallback((patch: Partial<FocusSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  /* ---------- audio ---------- */

  useEffect(() => {
    bell.current = new BellPlayer();
    ambient.current = new AmbientPlayer();
    return () => {
      ambient.current?.close();
      bell.current?.close();
      bell.current = null;
      ambient.current = null;
    };
  }, []);

  useEffect(() => {
    bell.current?.setVolume(settings.bellVolume);
  }, [settings.bellVolume]);

  useEffect(() => {
    ambient.current?.setVolume(settings.noiseVolume);
  }, [settings.noiseVolume]);

  // Ambient sound belongs to a running session, not to the page.
  useEffect(() => {
    const ctx = bell.current?.context();
    if (!ctx || !ambient.current) return;
    ambient.current.attach(ctx);
    if (running && settings.noise !== "none") ambient.current.play(settings.noise);
    else ambient.current.stop();
  }, [running, settings.noise]);

  /* ---------- clock ---------- */

  const now = () => performance.now() / 1000;

  const currentPosition = useCallback(() => {
    return liveRunning.current
      ? Math.min(liveTimeline.current.total, anchorPos.current + (now() - anchorAt.current))
      : anchorPos.current;
  }, []);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!liveRunning.current) return;

      const tl = liveTimeline.current;
      const p = currentPosition();
      const i = segIndexAt(tl, p);

      if (i !== lastSeg.current) {
        if (i > lastSeg.current) bell.current?.ring(liveSettings.current.bell);
        lastSeg.current = i;
      }

      if (p >= tl.total) {
        anchorPos.current = tl.total;
        liveRunning.current = false;
        setRunning(false);
        setFinished(true);
        setPosition(tl.total);
        bell.current?.ring(liveSettings.current.bell);
        ambient.current?.stop();
        clearSession();
        document.title = "Session complete";
        return;
      }

      setPosition(p);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [currentPosition]);

  // Keep the title and the stored session current, cheaply, once a second.
  useEffect(() => {
    if (!running) {
      document.title = finished
        ? "Session complete"
        : "Focus timer — Pomodoro";
      return;
    }
    const id = setInterval(() => {
      const tl = liveTimeline.current;
      const p = currentPosition();
      const st = stateAt(tl, p);
      const secs = secondsShown(st, liveSettings.current.countUp ? "up" : "down");
      document.title = `${fmtClock(secs, tl.hours)} ${PHASE_WORD[st.seg.kind]}`;
      saveSession({
        position: p,
        running: true,
        at: Date.now(),
        signature: sessionSignature(liveSettings.current),
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, finished, currentPosition]);

  /* ---------- transport ---------- */

  const start = useCallback(() => {
    bell.current?.unlock();
    const ctx = bell.current?.context();
    if (ctx && ambient.current) ambient.current.attach(ctx);

    const tl = liveTimeline.current;
    if (anchorPos.current >= tl.total) anchorPos.current = 0;
    anchorAt.current = now();
    lastSeg.current = segIndexAt(tl, anchorPos.current);
    liveRunning.current = true;
    setRunning(true);
    setFinished(false);
  }, []);

  const pause = useCallback(() => {
    anchorPos.current = currentPosition();
    liveRunning.current = false;
    setRunning(false);
    setPosition(anchorPos.current);
    saveSession({
      position: anchorPos.current,
      running: false,
      at: Date.now(),
      signature: sessionSignature(liveSettings.current),
    });
  }, [currentPosition]);

  const reset = useCallback(() => {
    anchorPos.current = 0;
    liveRunning.current = false;
    setRunning(false);
    setFinished(false);
    setPosition(0);
    lastSeg.current = 0;
    clearSession();
  }, []);

  const skip = useCallback(() => {
    const tl = liveTimeline.current;
    const i = segIndexAt(tl, currentPosition());
    const next = tl.segs[i + 1];
    const target = next ? next.start : tl.total;
    anchorPos.current = target;
    anchorAt.current = now();
    lastSeg.current = segIndexAt(tl, target);
    setPosition(target);
    if (target >= tl.total) {
      liveRunning.current = false;
      setRunning(false);
      setFinished(true);
    }
  }, [currentPosition]);

  const toggle = useCallback(() => {
    liveRunning.current ? pause() : start();
  }, [pause, start]);

  /* ---------- wake lock ---------- */

  useEffect(() => {
    if (!running) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (!("wakeLock" in navigator)) return;
        sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) void sentinel.release();
      } catch {
        sentinel = null;
      }
    };
    void acquire();

    // The lock is dropped whenever the tab hides, so it has to be retaken.
    const onVisible = () => {
      if (!document.hidden) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      try {
        void sentinel?.release();
      } catch {
        // already gone
      }
    };
  }, [running]);

  /* ---------- chrome that gets out of the way ---------- */

  useEffect(() => {
    const wake = () => {
      setIdle(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (liveRunning.current && !panelOpen && !soundOpen) {
        idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
      }
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [running, panelOpen, soundOpen]);

  useEffect(() => {
    if (!soundOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!soundRef.current?.contains(e.target as Node)) setSoundOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [soundOpen]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;

      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "r" || e.key === "R") {
        reset();
      } else if (e.key === "s" || e.key === "S") {
        skip();
      } else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (e.key === "Escape") {
        setPanelOpen(false);
        setSoundOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, reset, skip]);

  /* ---------- derived ---------- */

  const state = timeline.segs.length ? stateAt(timeline, position) : null;
  const kind: SegmentKind = state?.seg.kind ?? "focus";
  const theme = THEMES[settings.theme];
  const phase = finished ? theme.done : theme[kind === "lead" ? "lead" : kind];

  const seconds = state
    ? secondsShown(state, settings.countUp ? "up" : "down")
    : settings.focusMin * 60;
  const clock = finished ? "00:00" : fmtClock(seconds, timeline.hours);

  const fraction = state && state.seg.dur ? state.local / state.seg.dur : 0;
  const ringFraction = finished ? 1 : settings.countUp ? fraction : 1 - fraction;

  // How many focus blocks are behind us, for the dots.
  const focusSegs = timeline.segs.filter((s) => s.kind === "focus");
  const currentRound = state?.seg.round ?? 1;

  const focusedMinutes = Math.round(
    (timeline.segs
      .filter((s) => s.kind === "focus" && s.start + s.dur <= position + 0.5)
      .reduce((sum, s) => sum + s.dur, 0) +
      (state?.seg.kind === "focus" ? state.local : 0)) /
      60
  );

  const RADIUS = 46;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    reset();
    update({
      presetId: preset.id,
      focusMin: preset.focusMin,
      breakMin: preset.breakMin,
      rounds: preset.rounds,
    });
  };

  return (
    <main
      className={
        "focus" +
        (idle ? " focus--idle" : "") +
        (settings.motion ? " focus--motion" : "")
      }
      style={
        {
          "--from": phase.from,
          "--to": phase.to,
          "--phase-ink": phase.ink,
          "--phase-accent": phase.accent,
        } as React.CSSProperties
      }
    >
      <header className="focus__bar">
        <a className="wordmark" href="https://aiwithriz.com">
          Riz
        </a>
        <nav className="focus__nav">
          {/* Shortened rather than hidden on a narrow screen: this is the only
              signpost to the other tool, and burying it in Settings would make
              that product close to undiscoverable on a phone. */}
          <a href="/overlay">
            <span className="wide">Make a video overlay</span>
            <span className="narrow">Overlay</span>
          </a>
          <button
            type="button"
            className="focus__iconbtn"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            Settings
          </button>
        </nav>
      </header>

      <div className="focus__middle">
      <section className="focus__stage">
        <div className="dial">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="dial__track" cx="50" cy="50" r={RADIUS} />
            <circle
              className="dial__progress"
              cx="50"
              cy="50"
              r={RADIUS}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, ringFraction)))}
            />
          </svg>

          <div className="dial__face">
            <p className="dial__phase">{finished ? "Session complete" : PHASE_WORD[kind]}</p>
            {/*
              Each character gets a fixed cell.

              Wix Madefor Text has no tabular figures, so font-variant-numeric
              is silently ignored and the clock jumps as digits change — "1" is
              a third narrower than "4", which moves the whole line. This is the
              same fix drawFrame uses on the canvas, done in CSS.

              The spans are hidden from assistive tech and the plain string is
              exposed on the parent, so it is not read out digit by digit.
            */}
            <p className="dial__time" role="timer" aria-live="off" aria-label={clock}>
              {clock.split("").map((ch, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={ch === ":" ? "dial__colon" : "dial__digit"}
                >
                  {ch}
                </span>
              ))}
            </p>
            {focusSegs.length > 1 && !finished && (
              <p className="dial__dots" aria-label={`Round ${currentRound} of ${focusSegs.length}`}>
                {focusSegs.map((_, i) => (
                  <span key={i} className={i < currentRound - 1 ? "on" : i === currentRound - 1 ? "now" : ""} />
                ))}
              </p>
            )}
          </div>
        </div>

        {finished ? (
          <div className="focus__done">
            <p>
              {focusedMinutes} minute{focusedMinutes === 1 ? "" : "s"} focused
              {settings.task ? ` on ${settings.task}` : ""}.
            </p>
            <button className="btn primary" type="button" onClick={() => { reset(); start(); }}>
              Go again
            </button>
          </div>
        ) : (
          <input
            className="focus__task"
            type="text"
            maxLength={60}
            placeholder="What are you working on?"
            value={settings.task}
            onChange={(e) => update({ task: e.target.value })}
            aria-label="What are you working on?"
          />
        )}
      </section>

      <footer className="focus__controls">
        <div className="focus__transport">
          <button className="btn primary" type="button" onClick={toggle}>
            {running ? "Pause" : position > 0 && !finished ? "Resume" : "Start"}
          </button>
          <button className="btn" type="button" onClick={reset}>
            Reset
          </button>
          <button className="btn" type="button" onClick={skip}>
            Skip
          </button>

          {/*
            Background sound inline, because it is the one thing people change
            per session. Everything you set once — theme, bell, session lengths —
            stays in the sheet. One collapsed pill, so the page is not a control
            panel until you ask it to be.
          */}
          <div className="sound" ref={soundRef}>
            <button
              type="button"
              className={"chip" + (settings.noise !== "none" ? " chip--on" : "")}
              aria-expanded={soundOpen}
              aria-haspopup="true"
              onClick={() => setSoundOpen((v) => !v)}
            >
              {settings.noise === "none" ? "Sound off" : NOISE_LABELS[settings.noise]}
            </button>

            {soundOpen && (
              <div className="sound__pop" role="group" aria-label="Background sound">
                {(Object.keys(NOISE_LABELS) as NoiseKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={"sound__opt" + (settings.noise === k ? " sound__opt--on" : "")}
                    aria-pressed={settings.noise === k}
                    onClick={() => update({ noise: k })}
                  >
                    {k === "none" ? "Off" : NOISE_LABELS[k]}
                  </button>
                ))}
                <label className="sound__vol">
                  <span>Level</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(settings.noiseVolume * 100)}
                    onChange={(e) => update({ noiseVolume: Number(e.target.value) / 100 })}
                    aria-label="Background sound level"
                  />
                </label>
                <p className="sound__hint">
                  {settings.noise === "none"
                    ? "Plays only while the timer is running."
                    : NOISE_HINTS[settings.noise]}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="focus__presets" role="group" aria-label="Session length">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={"chip" + (settings.presetId === p.id ? " chip--on" : "")}
              aria-pressed={settings.presetId === p.id}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <p className="focus__keys">
          <kbd>Space</kbd> start · <kbd>S</kbd> skip · <kbd>R</kbd> reset · <kbd>F</kbd> full screen
        </p>
      </footer>
      </div>

      {/* A slide-over, not a sidebar. The page must never need it to be usable. */}
      <aside className={"sheet" + (panelOpen ? " sheet--open" : "")} aria-label="Settings" aria-hidden={!panelOpen}>
        <div className="sheet__head">
          <h2>Settings</h2>
          <button type="button" className="focus__iconbtn" onClick={() => setPanelOpen(false)}>
            Close
          </button>
        </div>

        <section>
          <h3>Background</h3>
          <div className="swatches">
            {Object.values(THEMES).map((t) => (
              <button
                key={t.id}
                type="button"
                className={"swatch" + (settings.theme === t.id ? " swatch--on" : "")}
                aria-pressed={settings.theme === t.id}
                onClick={() => update({ theme: t.id as ThemeId })}
              >
                {/* Two stripes: how the theme looks working, and on a break. */}
                <i
                  aria-hidden="true"
                  style={{
                    background:
                      `linear-gradient(135deg, ${t.focus.from}, ${t.focus.to} 58%, ` +
                      `${t.break.from} 58%, ${t.break.to})`,
                  }}
                />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.motion}
              onChange={(e) => update({ motion: e.target.checked })}
            />
            Slow drift
          </label>
          <p className="hint">
            The background changes with the phase, so a break looks different from
            work. Drift is paused when the tab is hidden and turned off entirely if
            your system asks for reduced motion.
          </p>
        </section>

        <section>
          <h3>Sound at each switch</h3>
          <select
            value={settings.bell}
            onChange={(e) => {
              const v = e.target.value as BellVariant;
              update({ bell: v });
              bell.current?.ring(v);
            }}
            aria-label="Bell sound"
          >
            {Object.entries(BELL_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <label className="slider-row">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.bellVolume * 100)}
              onChange={(e) => update({ bellVolume: Number(e.target.value) / 100 })}
            />
          </label>
          <p className="hint">Pick one to hear it.</p>
        </section>

        <section>
          <h3>Background sound</h3>
          <select
            value={settings.noise}
            onChange={(e) => update({ noise: e.target.value as NoiseKind })}
            aria-label="Background sound"
          >
            {Object.entries(NOISE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <label className="slider-row">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.noiseVolume * 100)}
              onChange={(e) => update({ noiseVolume: Number(e.target.value) / 100 })}
            />
          </label>
          <p className="hint">{NOISE_HINTS[settings.noise]} It plays only while the timer runs.</p>
        </section>

        <section>
          <h3>Session</h3>
          <div className="grid2">
            <label className="field">
              <span>Focus (minutes)</span>
              <input
                type="number"
                min={1}
                max={240}
                value={settings.focusMin}
                onChange={(e) => update({ focusMin: Number(e.target.value), presetId: "custom" })}
              />
            </label>
            <label className="field">
              <span>Break (minutes)</span>
              <input
                type="number"
                min={0}
                max={120}
                value={settings.breakMin}
                onChange={(e) => update({ breakMin: Number(e.target.value), presetId: "custom" })}
              />
            </label>
            <label className="field">
              <span>Rounds</span>
              <input
                type="number"
                min={1}
                max={12}
                value={settings.rounds}
                onChange={(e) => update({ rounds: Number(e.target.value), presetId: "custom" })}
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.countUp}
              onChange={(e) => update({ countUp: e.target.checked })}
            />
            Count up instead of down
          </label>
        </section>

        <section>
          <h3>Making a video?</h3>
          <p className="hint">
            The same timer renders to a green screen MP4 or a WebM with real
            transparency, to lay over your footage.
          </p>
          <a className="btn" href="/overlay">
            Open the overlay maker
          </a>
        </section>
      </aside>

      {panelOpen && (
        <button
          className="sheet__scrim"
          type="button"
          aria-label="Close settings"
          onClick={() => setPanelOpen(false)}
        />
      )}
    </main>
  );
}
