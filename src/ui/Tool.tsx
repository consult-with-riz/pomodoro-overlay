"use client";

/**
 * The tool: preview, transport, settings and export.
 *
 * Per-frame work is imperative on purpose. The preview canvas, playhead and
 * clock readouts are written through refs inside one requestAnimationFrame
 * loop, so the settings panel is not re-rendered sixty times a second. React
 * state is reserved for things that actually change on an event.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { BELL_LABELS, BellPlayer, type BellVariant } from "../bell";
import { drawFrame, hsl } from "../draw";
import { NOISE_HINTS, NOISE_LABELS, type NoiseKind } from "../noise";
import { LiveTimer } from "../live";
import {
  DEFAULTS,
  EDITORS,
  RES,
  STYLE_PRESETS,
  loadSettings,
  saveSettings,
  type Background,
  type Position,
  type Settings,
} from "../settings";
import {
  buildTimeline,
  fmtLen,
  labelFor,
  stateAt,
  type Timeline,
} from "../timeline";
import {
  RenderCancelled,
  detectCapabilities,
  estimate,
  renderVideo,
  saveVideo,
  type Capabilities,
  type RenderResult,
} from "../export";
import Backdrop from "./Backdrop";
import EmailCapture from "./EmailCapture";

type StatusKind = "" | "ok" | "err";

const POS_ROWS = ["t", "m", "b"] as const;
const POS_COLS = ["l", "c", "r"] as const;
const ROW_NAMES = { t: "Top", m: "Middle", b: "Bottom" } as const;
const COL_NAMES = { l: "left", c: "centre", r: "right" } as const;

export default function Tool() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [running, setRunning] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [full, setFull] = useState(false);

  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<{ text: string; kind: StatusKind }>({
    text: "",
    kind: "",
  });
  const [result, setResult] = useState<RenderResult | null>(null);
  const [editor, setEditor] = useState<string>(EDITORS[0].id);
  /** A still from the user's footage, shown behind the preview only. */
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const previewBell = useRef<BellPlayer | null>(null);

  const timeline: Timeline = useMemo(() => buildTimeline(settings), [settings]);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const nowRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);

  const timerRef = useRef<LiveTimer | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The rAF loop reads these rather than closing over stale props.
  const liveSettings = useRef(settings);
  const liveTimeline = useRef(timeline);
  const liveBackdrop = useRef<string | null>(null);
  liveSettings.current = settings;
  liveTimeline.current = timeline;
  liveBackdrop.current = backdrop;

  /* ---------- settings persistence ---------- */

  // Read after mount, never during render: localStorage does not exist on the
  // server and reading it during the first client render would mismatch.
  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveSettings(settings);
  }, [settings, hydrated]);

  // Mirrored in a ref so update() can tell whether a finished render exists
  // without taking `result` as a dependency and being rebuilt on every render.
  const resultRef = useRef<RenderResult | null>(null);
  const applyResult = useCallback((r: RenderResult | null) => {
    resultRef.current = r;
    setResult(r);
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));

      // Every setting but the live bell toggle changes the file, so a finished
      // render no longer matches what the panel says and has to be discarded.
      const changesOutput = Object.keys(patch).some((k) => k !== "sound");
      if (changesOutput && resultRef.current) {
        applyResult(null);
        setProgress(0);
        setStatus({
          text: "Settings changed. Render again to include them.",
          kind: "",
        });
      }
    },
    [applyResult]
  );

  /* ---------- timer ---------- */

  useEffect(() => {
    const timer = new LiveTimer(timeline, settings);
    timerRef.current = timer;
    const unsubscribe = timer.subscribe((s) => {
      setRunning(s.running);
      setAtStart(s.position <= 0 || s.finished);
    });
    return () => {
      unsubscribe();
      timer.destroy();
      timerRef.current = null;
    };
    // One timer for the life of the component; timeline and settings are
    // pushed in below rather than rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    timerRef.current?.setTimeline(timeline);
  }, [timeline]);

  useEffect(() => {
    timerRef.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) timerRef.current?.onVisible();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /* ---------- preview loop ---------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const timer = timerRef.current;
      if (!timer) return;
      timer.tick();

      const s = liveSettings.current;
      const tl = liveTimeline.current;
      const p = timer.position;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(320, Math.min(2560, Math.round(rect.width * dpr)));
      const H = Math.max(180, Math.min(1600, Math.round(rect.height * dpr)));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }

      // The preview always draws transparent and lets the stage's CSS show the
      // chosen screen colour, so the keying warnings are visible as you set up.
      // Over a still, always draw transparent: that is what the overlay looks
      // like on the footage once the screen colour has been keyed out.
      const overFootage = liveBackdrop.current !== null;
      const transparent = s.bg === "transparent";
      drawFrame(
        ctx,
        W,
        H,
        tl,
        p,
        { ...s, shadow: transparent ? s.shadow : false },
        overFootage || transparent ? "transparent" : s.bg
      );

      const pct = tl.total ? p / tl.total : 0;
      if (playheadRef.current) {
        playheadRef.current.style.left = `${pct * 100}%`;
      }
      if (scrubRef.current && document.activeElement !== scrubRef.current) {
        scrubRef.current.value = String(Math.floor(p));
      }
      if (nowRef.current) nowRef.current.textContent = fmtLen(p);
      if (phaseRef.current && tl.segs.length) {
        const st = stateAt(tl, p);
        const name = labelFor(st.seg.kind, s);
        phaseRef.current.textContent =
          tl.rounds > 1 && (st.seg.kind === "focus" || st.seg.kind === "break")
            ? `${name}, round ${st.seg.round} of ${tl.rounds}`
            : name;
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  /* ---------- auditioning the bell ---------- */

  useEffect(() => {
    previewBell.current = new BellPlayer();
    return () => {
      previewBell.current?.close();
      previewBell.current = null;
    };
  }, []);

  /* ---------- capability probe ---------- */

  useEffect(() => {
    let alive = true;
    void detectCapabilities().then((c) => {
      if (alive) setCaps(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* ---------- full screen and keys ---------- */

  const enterFull = useCallback(() => {
    setFull(true);
    void stageRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const exitFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.fullscreenElement === null) setFull(false);
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(tag)) {
        e.preventDefault();
        const timer = timerRef.current;
        if (!timer) return;
        timer.running ? timer.pause() : timer.start();
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  /* ---------- render ---------- */

  const onRender = useCallback(async () => {
    if (rendering) return;
    const controller = new AbortController();
    abortRef.current = controller;

    setRendering(true);
    applyResult(null);
    setProgress(0);
    setStatus({ text: "Preparing…", kind: "" });

    const [W, H] = RES[settings.res] ?? RES["1080"];
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;

    try {
      // A fallback face here would put the wrong glyphs in the file, so wait
      // for the exact weights before the first frame is drawn.
      await document.fonts.ready;

      const out = await renderVideo({
        settings,
        canvas,
        signal: controller.signal,
        onStage: (text) => setStatus({ text, kind: "" }),
        onProgress: (p) => {
          setProgress(p.done);
          const speed = p.speed ? `${Math.round(p.speed)}× real time` : "";
          const eta =
            p.eta !== null && Number.isFinite(p.eta)
              ? `, about ${fmtLen(p.eta)} left`
              : "";
          setStatus({
            text:
              `Rendered ${fmtLen(p.rendered)} of ${fmtLen(p.total)} ` +
              `(${Math.floor(p.done * 100)}%). ${speed}${eta}`,
            kind: "",
          });
        },
      });

      applyResult(out);
      const mb = (out.blob.size / 1048576).toFixed(out.blob.size > 10485760 ? 0 : 1);
      setStatus({
        text:
          `Your ${fmtLen(timeline.total)} video is ready (${mb} MB).` +
          (out.audioNote ? ` ${out.audioNote}` : ""),
        kind: "ok",
      });
    } catch (err) {
      if (err instanceof RenderCancelled) {
        setStatus({ text: "Render cancelled.", kind: "" });
        setProgress(0);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ text: message, kind: "err" });
        setProgress(0);
      }
    } finally {
      setRendering(false);
      abortRef.current = null;
    }
  }, [rendering, settings, timeline.total, applyResult]);

  const onSave = useCallback(async () => {
    if (!result) return;
    try {
      const outcome = await saveVideo(result.blob, result.name);
      if (outcome === "cancelled") {
        setStatus({ text: "Save cancelled. Select Save to try again.", kind: "" });
      } else if (outcome === "downloaded") {
        setStatus({ text: "Video saved to your downloads.", kind: "ok" });
      } else {
        setStatus({ text: "Video saved.", kind: "ok" });
      }
    } catch (err) {
      setStatus({
        text: err instanceof Error ? err.message : "Could not save the file.",
        kind: "err",
      });
    }
  }, [result]);

  // Warn before losing a render in progress.
  useEffect(() => {
    if (!rendering) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [rendering]);

  /* ---------- derived copy ---------- */

  const est = useMemo(() => estimate(settings), [settings]);

  /** A preset is "active" while every value it sets is still in place. */
  const activePreset = useMemo(() => {
    const match = STYLE_PRESETS.find((p) =>
      (Object.keys(p.apply) as (keyof Settings)[]).every(
        (k) => settings[k] === p.apply[k]
      )
    );
    return match?.id ?? "custom";
  }, [settings]);

  /*
   * The editor select follows the background rather than fighting it. Choosing
   * an editor sets the format; changing the format by hand moves the select to
   * an editor that matches, so the explanation underneath is never a lie.
   */
  const editorValue = useMemo(() => {
    const chosen = EDITORS.find((x) => x.id === editor);
    if (chosen && chosen.bg === settings.bg) return chosen.id;
    return EDITORS.find((x) => x.bg === settings.bg)?.id ?? EDITORS[0].id;
  }, [editor, settings.bg]);

  const colourWarning = useMemo(() => {
    if (settings.bg === "transparent") return "";
    const warnings: string[] = [];

    if (settings.bg === "black") {
      // A Screen blend keeps a pixel in proportion to how bright it is, so
      // dark colours quietly vanish instead of being keyed cleanly.
      const dark = (hex: string) => hsl(hex)[2] < 0.3;
      const names: string[] = [];
      if (dark(settings.textColor)) names.push("text");
      if (dark(settings.focusColor)) names.push("focus");
      if (dark(settings.breakColor)) names.push("break");
      if (names.length) {
        warnings.push(
          `Your ${names.join(" and ")} ${names.length > 1 ? "colours are" : "colour is"} ` +
            `dark, and a Screen blend will make dark pixels nearly invisible. Lighten ` +
            `${names.length > 1 ? "them" : "it"} or pick a green screen instead.`
        );
      }
      if (settings.plate === "light") {
        warnings.push("A light card stays almost fully opaque under a Screen blend, which hides your footage behind it.");
      }
      return warnings.join(" ");
    }
    // Saturated mid-lightness colours near the screen hue get keyed out with it.
    const clashes = (hex: string) => {
      const [h, s, l] = hsl(hex);
      if (!(s > 0.25 && l > 0.12 && l < 0.9)) return false;
      return settings.bg === "green" ? h >= 70 && h <= 170 : h >= 190 && h <= 255;
    };
    const names: string[] = [];
    if (clashes(settings.textColor)) names.push("text");
    if (clashes(settings.focusColor)) names.push("focus");
    if (clashes(settings.breakColor)) names.push("break");
    if (names.length) {
      warnings.push(
        `Your ${names.join(" and ")} ${names.length > 1 ? "colours are" : "colour is"} ` +
          `close to the ${settings.bg} screen and will be keyed out with it. Pick another ` +
          `colour or switch to ${settings.bg === "green" ? "blue" : "green"}.`
      );
    }
    if (settings.shadow && settings.plate === "none") {
      warnings.push(
        "The soft shadow is left out of green and blue screen videos, because a shadow can't be keyed cleanly."
      );
    }
    return warnings.join(" ");
  }, [settings]);

  const capabilityWarning = useMemo(() => {
    if (!caps) return null;
    if (!caps.videoEncoder) {
      return "This browser can't encode video. The timer works, but rendering needs Chrome or Edge on a desktop computer.";
    }
    if (settings.bg === "transparent" && !caps.vp9Alpha) {
      return "This browser can't encode transparent video. Pick Green MP4 or Blue MP4, or use Chrome or Edge on a desktop.";
    }
    if (settings.bg !== "transparent" && !caps.h264) {
      return "This browser can't encode H.264. Try the transparent WebM instead, or use Chrome or Edge on a desktop.";
    }
    return null;
  }, [caps, settings.bg]);

  const bgHint =
    settings.bg === "transparent"
      ? "Saves a WebM with a real alpha channel. Works in OBS, DaVinci Resolve, Kdenlive, Shotcut and browsers. Premiere Pro and Final Cut need the green MP4 instead."
      : settings.bg === "black"
        ? "Saves an MP4 on solid black. Put it above your footage and set the layer to a Screen blend mode — no keying, no coloured fringe. Dark parts of the overlay will fade out too, so it suits bright timers."
        : `Saves an MP4 on solid ${settings.bg}. Drop it above your footage and key out the ${settings.bg} with your editor's chroma key. Works everywhere.`;

  const startLabel = running ? "Pause" : atStart ? "Start" : "Resume";

  /* ---------- controls ---------- */

  const num = (key: keyof Settings) => ({
    value: String(settings[key] as number),
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      update({ [key]: e.target.value === "" ? settings[key] : Number(e.target.value) } as Partial<Settings>),
  });

  const text = (key: keyof Settings) => ({
    value: String(settings[key]),
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      update({ [key]: e.target.value } as Partial<Settings>),
  });

  const check = (key: keyof Settings) => ({
    checked: Boolean(settings[key]),
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      update({ [key]: e.target.checked } as Partial<Settings>),
  });

  const choose = (key: keyof Settings) => ({
    value: String(settings[key]),
    onChange: (e: ChangeEvent<HTMLSelectElement>) =>
      update({ [key]: e.target.value } as Partial<Settings>),
  });

  return (
    <div className="app">
      <header className="head">
        <div className="brand">
          <a className="wordmark" href="https://aiwithriz.com">
            Riz
          </a>
          <h1>Pomodoro timer</h1>
          <p>
            Render the timer as a green screen MP4 or a WebM with real
            transparency, to lay over your footage. Everything happens in this
            tab — nothing is uploaded.{" "}
            <a href="/">Just want to focus? Use the plain timer →</a>
          </p>
        </div>
      </header>

      <div className="stagecol">
        <div
          className={"stage" + (full ? " full" : "")}
          id="stage"
          ref={stageRef}
          data-bg={settings.bg}
        >
          {backdrop && (
            // Behind the canvas, because drawFrame clears its context every
            // frame and would wipe anything drawn underneath.
            <img className="stage__backdrop" src={backdrop} alt="" aria-hidden="true" />
          )}
          <canvas ref={canvasRef} aria-label="Timer preview" />
          <span className="stage-tag">
            {settings.bg === "green"
              ? "Green screen preview"
              : settings.bg === "blue"
                ? "Blue screen preview"
                : "Transparent preview"}
          </span>
          <button className="btn dark exitfull" type="button" onClick={exitFull}>
            Exit full screen
          </button>
        </div>

        <div className="transport">
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              const timer = timerRef.current;
              if (!timer) return;
              timer.running ? timer.pause() : timer.start();
            }}
          >
            {startLabel}
          </button>
          <button className="btn" type="button" onClick={() => timerRef.current?.reset()}>
            Reset
          </button>
          <button className="btn" type="button" onClick={() => timerRef.current?.skip()}>
            Skip to next
          </button>
          <span className="spacer" />
          <label className="check" style={{ margin: "0 6px 0 0" }}>
            <input type="checkbox" {...check("sound")} /> Bell sound
          </label>
          <button className="btn ghost" type="button" onClick={enterFull}>
            Full screen
          </button>
        </div>

        <div className="timeline">
          <div className="strip" aria-hidden="true">
            {timeline.segs.map((seg, i) => (
              <div
                key={i}
                style={{
                  flex: String(seg.dur),
                  background:
                    seg.kind === "focus"
                      ? settings.focusColor
                      : seg.kind === "break"
                        ? settings.breakColor
                        : seg.kind === "done"
                          ? "var(--ink)"
                          : "var(--line)",
                }}
                title={`${labelFor(seg.kind, settings)}, ${fmtLen(seg.dur)}`}
              />
            ))}
          </div>
          <div className="playhead" ref={playheadRef} />
          <input
            ref={scrubRef}
            type="range"
            min={0}
            max={Math.max(1, Math.floor(timeline.total))}
            step={1}
            defaultValue={0}
            aria-label="Position in session"
            onChange={(e) => timerRef.current?.seek(Number(e.target.value))}
          />
          <div className="tlmeta">
            <span>
              <strong ref={nowRef}>0:00</strong>
            </span>
            <span ref={phaseRef} />
            <span>{fmtLen(timeline.total)}</span>
          </div>
        </div>
      </div>

      <aside className="panel" aria-label="Settings">
        <section>
          <h2>Session</h2>
          <div className="grid2">
            <label className="field">
              <span>Focus (minutes)</span>
              <input type="number" min={1} max={240} step={1} {...num("focusMin")} />
            </label>
            <label className="field">
              <span>Break (minutes)</span>
              <input type="number" min={0} max={120} step={1} {...num("breakMin")} />
            </label>
            <label className="field">
              <span>Rounds</span>
              <input type="number" min={1} max={12} step={1} {...num("rounds")} />
            </label>
            <label className="field">
              <span>Timer counts</span>
              <select {...choose("direction")}>
                <option value="down">Down</option>
                <option value="up">Up</option>
              </select>
            </label>
            <label className="field">
              <span>Lead-in (seconds)</span>
              <input type="number" min={0} max={600} step={1} {...num("leadSec")} />
            </label>
            <label className="field">
              <span>End screen (seconds)</span>
              <input type="number" min={0} max={120} step={1} {...num("outroSec")} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" {...check("endWithBreak")} /> Finish with a break
            after the last round
          </label>
          <p className="hint">
            The lead-in covers your intro before the first focus block. Keep the end
            screen at 5 seconds or more so the final bell fits in a rendered video.
          </p>
        </section>

        <section>
          <h2>Words on screen</h2>
          <div className="grid2">
            <label className="field">
              <span>Focus label</span>
              <input type="text" maxLength={24} {...text("labelFocus")} />
            </label>
            <label className="field">
              <span>Break label</span>
              <input type="text" maxLength={24} {...text("labelBreak")} />
            </label>
            <label className="field">
              <span>Lead-in label</span>
              <input type="text" maxLength={24} {...text("labelLead")} />
            </label>
            <label className="field">
              <span>End label</span>
              <input type="text" maxLength={24} {...text("labelDone")} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" {...check("showLabel")} /> Show the label
          </label>
          <label className="check">
            <input type="checkbox" {...check("showRound")} /> Show &ldquo;Round 1 of
            4&rdquo; when there&rsquo;s more than one round
          </label>
        </section>

        <section>
          <h2>Look</h2>
          <span className="lbl">Start from a preset</span>
          <div className="presets" role="group" aria-label="Style preset">
            {STYLE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={"chip" + (activePreset === p.id ? " chip--on" : "")}
                aria-pressed={activePreset === p.id}
                title={p.hint}
                onClick={() => update(p.apply)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginBottom: 14 }}>
            {STYLE_PRESETS.find((p) => p.id === activePreset)?.hint ??
              "Every control below stays yours to change — a preset is only a starting point."}
          </p>

          <span className="lbl">Style</span>
          <div
            className="seg"
            role="radiogroup"
            aria-label="Style"
            style={{ margin: "4px 0 12px" }}
          >
            {(["ring", "bar", "digits"] as const).map((v) => (
              <label key={v}>
                <input
                  type="radio"
                  name="style"
                  value={v}
                  checked={settings.style === v}
                  onChange={() => update({ style: v })}
                />
                <span>{v === "ring" ? "Ring" : v === "bar" ? "Bar" : "Digits"}</span>
              </label>
            ))}
          </div>
          <div className="grid2">
            <label className="field">
              <span>Typeface</span>
              <select {...choose("font")}>
                <option value="bsd">Big Shoulders</option>
                <option value="grotesk">Schibsted Grotesk</option>
                <option value="mono">JetBrains Mono</option>
                <option value="serif">Instrument Serif</option>
              </select>
            </label>
            <label className="field">
              <span>Behind the timer</span>
              <select {...choose("plate")}>
                <option value="none">Nothing</option>
                <option value="dark">Dark card</option>
                <option value="light">Light card</option>
              </select>
            </label>
            <label className="field">
              <span>Text colour</span>
              <input type="color" {...text("textColor")} />
            </label>
            <label className="field">
              <span>Focus colour</span>
              <input type="color" {...text("focusColor")} />
            </label>
            <label className="field">
              <span>Break colour</span>
              <input type="color" {...text("breakColor")} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" {...check("shadow")} /> Soft shadow (transparent
            video only)
          </label>
          <div className="warn" role="status">
            {colourWarning}
          </div>
        </section>

        <section>
          <h2>Placement</h2>
          <div className="row">
            <div>
              <span className="lbl" id="posLbl">
                Position
              </span>
              <div className="posgrid" role="group" aria-labelledby="posLbl">
                {POS_ROWS.map((r) =>
                  POS_COLS.map((c) => {
                    const pos = (r + c) as Position;
                    return (
                      <button
                        key={pos}
                        type="button"
                        aria-label={
                          pos === "mc" ? "Centre" : `${ROW_NAMES[r]} ${COL_NAMES[c]}`
                        }
                        aria-pressed={settings.pos === pos}
                        onClick={() => update({ pos })}
                      />
                    );
                  })
                )}
              </div>
            </div>
            <label className="field" style={{ flex: 1, minWidth: 150 }}>
              <span>
                Size{" "}
                <b style={{ color: "var(--ink)", fontWeight: 600 }}>
                  {settings.scale}%
                </b>
              </span>
              <input
                className="slider"
                type="range"
                min={14}
                max={70}
                step={1}
                {...num("scale")}
              />
            </label>
          </div>
        </section>

        <section>
          <h2>Check it over your footage</h2>
          <Backdrop value={backdrop} onChange={setBackdrop} />
        </section>

        <section>
          <h2>Export video</h2>

          {/* The question people can answer, rather than one about codecs. */}
          <label className="field">
            <span>What will you edit in?</span>
            <select
              value={editorValue}
              onChange={(e) => {
                const target = EDITORS.find((x) => x.id === e.target.value);
                if (!target) return;
                setEditor(target.id);
                update({ bg: target.bg });
              }}
            >
              {EDITORS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{EDITORS.find((x) => x.id === editorValue)?.why}</p>

          <span className="lbl" style={{ display: "block", marginTop: 14 }}>
            Background
          </span>
          <div
            className="seg"
            role="radiogroup"
            aria-label="Video background"
            style={{ margin: "4px 0 8px" }}
          >
            {(
              [
                ["green", "Green"],
                ["blue", "Blue"],
                ["black", "Black"],
                ["transparent", "Clear"],
              ] as const
            ).map(([v, label]) => (
              <label key={v}>
                <input
                  type="radio"
                  name="bg"
                  value={v}
                  checked={settings.bg === v}
                  onChange={() => update({ bg: v as Background })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className="hint">{bgHint}</p>

          {capabilityWarning && (
            <div className="warn" role="status">
              {capabilityWarning}
            </div>
          )}

          <div className="grid2" style={{ marginTop: 10 }}>
            <label className="field">
              <span>Resolution</span>
              <select {...choose("res")}>
                <option value="720">1280 × 720</option>
                <option value="1080">1920 × 1080</option>
                <option value="2160">3840 × 2160</option>
              </select>
            </label>
            <label className="field">
              <span>Frame rate</span>
              <select {...choose("fps")}>
                <option value="10">10 fps (renders fastest)</option>
                <option value="24">24 fps</option>
                <option value="25">25 fps</option>
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </label>
          </div>
          <p className="hint">
            The digits only change once a second, so 10 fps looks the same as 30 fps
            once it&rsquo;s in your edit, and renders about three times faster.
          </p>
          <label className="check">
            <input type="checkbox" {...check("bell")} /> Add a sound to the audio at
            every switch
          </label>
          {settings.bell && (
            <div className="grid2" style={{ marginTop: 10 }}>
              <label className="field">
                <span>Sound</span>
                <select
                  value={settings.bellSound}
                  onChange={(e) => {
                    const v = e.target.value as BellVariant;
                    update({ bellSound: v });
                    previewBell.current?.ring(v);
                  }}
                >
                  {Object.entries(BELL_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <label className="field" style={{ marginTop: 14 }}>
            <span>Background sound in the video</span>
            <select
              value={settings.noise}
              onChange={(e) => update({ noise: e.target.value as NoiseKind })}
            >
              {Object.entries(NOISE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {settings.noise !== "none" && (
            <label className="field" style={{ marginTop: 10 }}>
              <span>Level {Math.round(settings.noiseVolume * 100)}%</span>
              <input
                className="slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(settings.noiseVolume * 100)}
                onChange={(e) => update({ noiseVolume: Number(e.target.value) / 100 })}
              />
            </label>
          )}
          <p className="hint">
            {settings.noise === "none"
              ? "Silent by default. Most editors prefer to add their own ambience on a separate track."
              : `${NOISE_HINTS[settings.noise]} It is mixed into the file for the whole session — ` +
                `noise cannot be compressed, so it adds about ${Math.round(est.audioBytes / 1048576)} MB here ` +
                `and can't be separated out later.`}
          </p>

          <dl className="facts">
            <div>
              <dt>Video length</dt>
              <dd>{fmtLen(timeline.total)}</dd>
            </div>
            <div>
              <dt>Frames</dt>
              <dd>{est.frames.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>
                {est.width} × {est.height}
              </dd>
            </div>
            <div>
              <dt>Rough size</dt>
              <dd>
                {est.approxBytes > 1048576
                  ? `~${Math.round(est.approxBytes / 1048576)} MB`
                  : "< 1 MB"}
                {est.bedOn ? ` (${Math.round(est.audioBytes / 1048576)} MB audio)` : ""}
              </dd>
            </div>
            <div>
              <dt>File type</dt>
              <dd>
                {settings.bg === "transparent"
                  ? "WebM (VP9 with alpha)"
                  : "MP4 (H.264)"}
              </dd>
            </div>
          </dl>

          {est.warning && (
            <div className="warn" role="status">
              {est.warning}
            </div>
          )}

          <div className="render-box">
            <button
              className="btn primary"
              type="button"
              onClick={onRender}
              disabled={rendering || caps?.videoEncoder === false}
            >
              Render video
            </button>
            {(rendering || progress > 0) && (
              <div className="progress">
                <i style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            <div className={"status" + (status.kind ? " " + status.kind : "")} role="status" aria-live="polite">
              {status.text}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {rendering && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                >
                  Cancel render
                </button>
              )}
              {result && !rendering && (
                <button className="btn primary" type="button" onClick={onSave}>
                  {settings.bg === "transparent" ? "Save WebM" : "Save MP4"}
                </button>
              )}
            </div>
          </div>
          <p className="hint">
            Rendering runs in this tab, faster than real time. Keep the tab open
            until it finishes. Chrome or Edge on a desktop gives the best results.
          </p>
        </section>

        <EmailCapture />
      </aside>
    </div>
  );
}
