/**
 * The render pipeline: timeline in, video file out.
 *
 * Deliberately DOM-free. It is handed a canvas and a progress callback and
 * touches nothing else, which is what keeps the move to a Web Worker with
 * OffscreenCanvas a small change rather than a rewrite.
 */
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeVideo,
  getFirstEncodableAudioCodec,
} from "mediabunny";
import { BELL_LEN, bellSample, bellTimes, type BellVariant } from "./bell";
import { drawFrame } from "./draw";
import { makeNoiseLoop } from "./noise";
import { RES, type Settings } from "./settings";
import { buildTimeline, fmtLen, type Timeline } from "./timeline";

export interface Capabilities {
  /** WebCodecs at all. Without this nothing can be rendered. */
  videoEncoder: boolean;
  /** H.264 at 1080p, for the green and blue screen MP4s. */
  h264: boolean;
  /** VP9 carrying an alpha channel, for transparent WebM. */
  vp9Alpha: boolean;
  /** File System Access API, so the user picks where the file goes. */
  filePicker: boolean;
}

/**
 * Probe what this browser can actually do, at load, so someone doesn't
 * configure a 50 minute render and only then discover it can't be encoded.
 */
export async function detectCapabilities(): Promise<Capabilities> {
  const videoEncoder =
    typeof globalThis !== "undefined" && "VideoEncoder" in globalThis;
  const filePicker =
    typeof globalThis !== "undefined" && "showSaveFilePicker" in globalThis;

  if (!videoEncoder) {
    return { videoEncoder: false, h264: false, vp9Alpha: false, filePicker };
  }

  const probe = async (
    codec: Parameters<typeof canEncodeVideo>[0],
    alpha: "keep" | "discard"
  ) => {
    try {
      return await canEncodeVideo(codec, {
        width: 1920,
        height: 1080,
        quality: QUALITY_HIGH,
        alpha,
      });
    } catch {
      return false;
    }
  };

  const [h264, vp9Alpha] = await Promise.all([
    probe("avc", "discard"),
    probe("vp9", "keep"),
  ]);

  return { videoEncoder: true, h264, vp9Alpha, filePicker };
}

export interface RenderEstimate {
  width: number;
  height: number;
  fps: number;
  frames: number;
  seconds: number;
  /** Very rough, from pixel count. Only used to warn, never to promise. */
  approxBytes: number;
  /** The audio share of the above, which an ambient bed dominates. */
  audioBytes: number;
  /** Whether an ambient bed is switched on. */
  bedOn: boolean;
  /**
   * Whether the whole file is likely to fit in memory. The output is buffered
   * until finalize, so a long 4K render can exhaust the tab before it ends.
   */
  risky: boolean;
  warning: string | null;
}

/** Buffered output means memory is the ceiling; warn well before it is hit. */
const RISKY_BYTES = 1_200_000_000;

/** Roughly what Opus spends on an incompressible signal, in bits per second. */
const AUDIO_BITRATE = 96_000;

export function estimate(settings: Settings): RenderEstimate {
  const tl = buildTimeline(settings);
  const [width, height] = RES[settings.res] ?? RES["1080"];
  const fps = Number(settings.fps) || 30;
  const frames = Math.round(tl.total * fps);

  // Rough bits-per-pixel for the quality preset, doubled for alpha.
  const bpp = settings.bg === "transparent" ? 0.14 : 0.07;
  const videoBytes = (width * height * bpp * frames) / 8;

  /*
   * Audio is normally a rounding error, because a track of silence with a few
   * bells in it compresses to almost nothing. An ambient bed is the opposite:
   * noise is incompressible by definition, so the encoder spends its full
   * bitrate for the whole session. That is worth showing rather than letting
   * someone discover it at download time.
   */
  const bedOn = settings.noise !== "none" && settings.noiseVolume > 0;
  const audioBytes = bedOn ? (AUDIO_BITRATE / 8) * tl.total : tl.total * 900;
  const approxBytes = videoBytes + audioBytes;
  const risky = approxBytes > RISKY_BYTES;

  return {
    width,
    height,
    fps,
    frames,
    seconds: tl.total,
    approxBytes,
    audioBytes,
    bedOn,
    risky,
    warning: risky
      ? `A ${fmtLen(tl.total)} render at ${width} × ${height} could need more ` +
        `memory than the tab has, and the file is only written when it finishes. ` +
        `Try a lower resolution or frame rate, or split the session.`
      : null,
  };
}

export interface RenderResult {
  blob: Blob;
  name: string;
  /** Set when the bell was dropped because no audio codec was available. */
  audioNote: string | null;
}

export interface RenderProgress {
  /** 0 to 1. */
  done: number;
  /** Seconds of video rendered so far. */
  rendered: number;
  /** Total seconds. */
  total: number;
  /** Multiples of real time. */
  speed: number;
  /** Seconds remaining, or null before there is enough data to guess. */
  eta: number | null;
}

export interface RenderOptions {
  settings: Settings;
  /** A canvas at the target resolution. Supplied by the caller so this file
   *  never touches the DOM, and a worker can pass an OffscreenCanvas. */
  canvas: HTMLCanvasElement | OffscreenCanvas;
  onProgress?: (p: RenderProgress) => void;
  onStage?: (message: string) => void;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to performance.now. */
  now?: () => number;
}

const AUDIO_SAMPLE_RATE = 48000;

/** Let the event loop run without being throttled the way a timer would be. */
function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}

/**
 * One second of mono audio: whichever bells overlap it, over the ambient bed.
 *
 * The bed is a pre-built loop tiled across the session, so the seam is
 * inaudible and generating it costs nothing per chunk.
 */
function audioChunk(
  second: number,
  bells: number[],
  bellVariant: BellVariant,
  bed: Float32Array | null,
  bedGain: number
): AudioBuffer {
  const buffer = new AudioBuffer({
    length: AUDIO_SAMPLE_RATE,
    numberOfChannels: 1,
    sampleRate: AUDIO_SAMPLE_RATE,
  });
  const data = buffer.getChannelData(0);

  if (bed && bedGain > 0) {
    const offset = Math.round(second * AUDIO_SAMPLE_RATE);
    for (let n = 0; n < AUDIO_SAMPLE_RATE; n++) {
      data[n] = bed[(offset + n) % bed.length] * bedGain;
    }
  }

  for (const start of bells) {
    if (start > second + 1 || start + BELL_LEN < second) continue;
    for (let n = 0; n < AUDIO_SAMPLE_RATE; n++) {
      const tau = second + n / AUDIO_SAMPLE_RATE - start;
      if (tau >= 0 && tau <= BELL_LEN) data[n] += bellSample(tau, bellVariant);
    }
  }

  // The bed plus a bell can exceed full scale; clamp rather than let the
  // encoder wrap and produce a crack on every chime.
  for (let n = 0; n < AUDIO_SAMPLE_RATE; n++) {
    if (data[n] > 1) data[n] = 1;
    else if (data[n] < -1) data[n] = -1;
  }

  return buffer;
}

export function outputName(settings: Settings, height: number): string {
  const ext = settings.bg === "transparent" ? "webm" : "mp4";
  const rounds = settings.rounds > 1 ? `${settings.rounds}x-` : "";
  return `pomodoro-${settings.focusMin}-${settings.breakMin}-${rounds}${settings.bg}-${height}p.${ext}`;
}

export class RenderCancelled extends Error {
  constructor() {
    super("Render cancelled.");
    this.name = "RenderCancelled";
  }
}

export async function renderVideo({
  settings,
  canvas,
  onProgress,
  onStage,
  signal,
  now = () => performance.now(),
}: RenderOptions): Promise<RenderResult> {
  const tl: Timeline = buildTimeline(settings);
  const [W, H] = RES[settings.res] ?? RES["1080"];
  const fps = Number(settings.fps) || 30;
  const transparent = settings.bg === "transparent";

  // A shadow cannot be keyed cleanly, so it is dropped on screen colours
  // whatever the setting says.
  const cfg: Settings = transparent ? settings : { ...settings, shadow: false };

  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext("2d", {
    alpha: true,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Could not get a 2D drawing context.");

  onStage?.("Checking what this browser can encode…");

  const format = transparent
    ? new WebMOutputFormat()
    : new Mp4OutputFormat({ fastStart: "in-memory" });

  const candidates = transparent
    ? (["vp9", "vp8", "av1"] as const)
    : (["avc", "hevc"] as const);

  let vcodec: (typeof candidates)[number] | null = null;
  for (const codec of candidates) {
    try {
      const ok = await canEncodeVideo(codec, {
        width: W,
        height: H,
        quality: QUALITY_HIGH,
        alpha: transparent ? "keep" : "discard",
      });
      if (ok) {
        vcodec = codec;
        break;
      }
    } catch {
      // try the next candidate
    }
  }
  if (!vcodec) {
    throw new Error(
      transparent
        ? "This browser can't encode transparent video. Use Chrome or Edge on a desktop, or pick Green MP4."
        : `This browser can't encode H.264 at ${W} × ${H}. Try 1920 × 1080, or use Chrome or Edge on a desktop.`
    );
  }

  const output = new Output({ format, target: new BufferTarget() });
  const video = new CanvasSource(canvas as HTMLCanvasElement, {
    codec: vcodec,
    quality: QUALITY_HIGH,
    keyFrameInterval: 2,
    alpha: transparent ? "keep" : "discard",
  });
  output.addVideoTrack(video, { frameRate: fps });

  let audio: AudioBufferSource | null = null;
  let audioNote: string | null = null;

  // An audio track is only worth adding when something will actually be in it:
  // an audible bell, an ambient bed, or both.
  const wantsBell = cfg.bell && cfg.bellSound !== "none";
  const wantsBed = cfg.noise !== "none" && cfg.noiseVolume > 0;
  if (wantsBell || wantsBed) {
    // WebM carries Opus; MP4 prefers AAC but takes Opus.
    const list = transparent ? (["opus"] as const) : (["aac", "opus"] as const);
    let acodec = null;
    try {
      acodec = await getFirstEncodableAudioCodec([...list], {
        numberOfChannels: 1,
        sampleRate: AUDIO_SAMPLE_RATE,
        quality: QUALITY_HIGH,
      });
    } catch {
      acodec = null;
    }
    if (acodec) {
      audio = new AudioBufferSource({ codec: acodec, quality: QUALITY_HIGH });
      output.addAudioTrack(audio);
    } else {
      audioNote = "The audio was left out because this browser can't encode it.";
    }
  }

  const bells = wantsBell ? bellTimes(tl) : [];
  const frames = Math.round(tl.total * fps);

  // Built once and tiled. Only when an ambient bed was actually chosen —
  // silence costs the encoder almost nothing, continuous noise does not.
  const bed = wantsBed ? makeNoiseLoop(cfg.noise as Exclude<typeof cfg.noise, "none">, AUDIO_SAMPLE_RATE) : null;
  const bedGain = bed ? cfg.noiseVolume : 0;

  try {
    await output.start();
    onStage?.("Rendering…");

    const started = now();
    let lastReport = 0;

    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new RenderCancelled();

      const t = i / fps;
      if (audio && i % fps === 0) {
        await audio.add(audioChunk(t, bells, cfg.bellSound, bed, bedGain));
      }
      drawFrame(ctx, W, H, tl, t, cfg, cfg.bg);
      await video.add(t, 1 / fps);

      const at = now();
      if (at - lastReport > 120) {
        lastReport = at;
        const done = (i + 1) / frames;
        const elapsed = (at - started) / 1000;
        onProgress?.({
          done,
          rendered: t,
          total: tl.total,
          speed: elapsed > 0 ? t / elapsed : 0,
          eta: done > 0.01 ? (elapsed * (1 - done)) / done : null,
        });
        // Without this the page locks up for the whole render.
        await yieldNow();
      }
    }

    onStage?.("Finishing the file…");
    await output.finalize();

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("The encoder produced no data.");

    const blob = new Blob([buffer], {
      type: transparent ? "video/webm" : "video/mp4",
    });
    onProgress?.({
      done: 1,
      rendered: tl.total,
      total: tl.total,
      speed: 0,
      eta: 0,
    });

    return { blob, name: outputName(cfg, H), audioNote };
  } catch (err) {
    try {
      if (output.state !== "finalized" && output.state !== "canceled") {
        await output.cancel();
      }
    } catch {
      // nothing useful to do if teardown also fails
    }
    throw err;
  }
}

export type SaveOutcome = "saved" | "cancelled" | "downloaded";

/**
 * Save the rendered file.
 *
 * Prefers the File System Access API so the user chooses the destination and
 * the bytes stream to disk. Everywhere else falls back to an object URL and a
 * synthetic link click, which lands in the downloads folder.
 */
export async function saveVideo(
  blob: Blob,
  name: string
): Promise<SaveOutcome> {
  const picker = (
    globalThis as unknown as {
      showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (picker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({
        suggestedName: name,
        types: [
          {
            description: blob.type === "video/webm" ? "WebM video" : "MP4 video",
            accept: { [blob.type]: [name.endsWith(".webm") ? ".webm" : ".mp4"] },
          },
        ],
      });
    } catch (err) {
      // The user dismissing the picker is a normal outcome, not a failure.
      if (err instanceof DOMException && err.name === "AbortError") {
        return "cancelled";
      }
      throw err;
    }
    const writable = await handle.createWritable();
    await blob.stream().pipeTo(writable);
    return "saved";
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}
