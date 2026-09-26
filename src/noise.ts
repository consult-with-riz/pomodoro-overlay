/**
 * Ambient background sound for the focus timer.
 *
 * Everything here is synthesised rather than streamed from audio files. Rain
 * and café loops would mean megabytes to host, licences to check, and a seam
 * where the loop repeats. Noise is a few lines of maths, loops perfectly, and
 * costs nothing — so it ships first, and samples only get added if people ask.
 *
 * The buffer is generated once and looped, which keeps CPU near zero for the
 * length of a session.
 */

export type NoiseKind = "none" | "brown" | "pink" | "white";

export const NOISE_LABELS: Record<NoiseKind, string> = {
  none: "Silent",
  brown: "Brown noise",
  pink: "Pink noise",
  white: "White noise",
};

export const NOISE_HINTS: Record<NoiseKind, string> = {
  none: "No background sound.",
  brown: "Deep and soft, like distant surf. The least fatiguing over an hour.",
  pink: "Balanced, close to steady rainfall.",
  white: "Bright and flat. Good at masking speech.",
};

/** Long enough that the loop point is not perceptible. */
export const BUFFER_SECONDS = 8;

function fillWhite(out: Float32Array): void {
  for (let i = 0; i < out.length; i++) out[i] = Math.random() * 2 - 1;
}

/**
 * Brown noise: white noise integrated, which rolls off 6dB per octave.
 * The leak factor keeps the running sum from wandering away from zero.
 */
function fillBrown(out: Float32Array): void {
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = last * 3.5;
  }
}

/**
 * Pink noise: 3dB per octave, via the Voss-McCartney approximation.
 * Cheaper and steadier than a filter chain, and accurate enough by ear.
 */
function fillPink(out: Float32Array): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

/**
 * Taper the first and last 50ms into each other so the loop seam is silent.
 * Without this there is an audible tick every eight seconds.
 */
function crossfadeEnds(out: Float32Array, sampleRate: number): void {
  const fade = Math.min(Math.floor(sampleRate * 0.05), Math.floor(out.length / 4));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const head = out[i];
    const tail = out[out.length - fade + i];
    out[i] = head * t + tail * (1 - t);
  }
}

/**
 * Build a seamless noise loop as plain samples.
 *
 * Shared by live playback and the exported audio track, so the bed in a
 * rendered video is the same sound the focus timer plays. The export tiles
 * this buffer across the whole session, which is why the ends are crossfaded.
 */
export function makeNoiseLoop(
  kind: Exclude<NoiseKind, "none">,
  sampleRate: number,
  seconds: number = BUFFER_SECONDS
): Float32Array {
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  if (kind === "brown") fillBrown(out);
  else if (kind === "pink") fillPink(out);
  else fillWhite(out);
  crossfadeEnds(out, sampleRate);
  return out;
}

export class AmbientPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffers = new Map<NoiseKind, AudioBuffer>();
  private kind: NoiseKind = "none";
  private volume = 0.35;

  /** Share the bell's context so both run on one clock and one resume. */
  attach(ctx: AudioContext): void {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(ctx.destination);
  }

  private bufferFor(kind: NoiseKind): AudioBuffer | null {
    if (!this.ctx || kind === "none") return null;
    const existing = this.buffers.get(kind);
    if (existing) return existing;

    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * BUFFER_SECONDS), sr);
    const data = buf.getChannelData(0);
    if (kind === "brown") fillBrown(data);
    else if (kind === "pink") fillPink(data);
    else fillWhite(data);
    crossfadeEnds(data, sr);

    this.buffers.set(kind, buf);
    return buf;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain && this.kind !== "none") this.ramp(this.volume);
  }

  private ramp(to: number): void {
    if (!this.ctx || !this.gain) return;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    // Never a hard cut; a step in a noise floor is very noticeable.
    this.gain.gain.linearRampToValueAtTime(to, now + 0.4);
  }

  play(kind: NoiseKind): void {
    if (!this.ctx || !this.gain) return;
    if (kind === "none") {
      this.stop();
      return;
    }
    if (this.kind === kind && this.source) {
      this.ramp(this.volume);
      return;
    }

    this.stopNow();
    const buffer = this.bufferFor(kind);
    if (!buffer) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.gain);
    src.start();

    this.source = src;
    this.kind = kind;
    this.ramp(this.volume);
  }

  /** Fade out, then tear the node down once it is inaudible. */
  stop(): void {
    if (!this.source) return;
    this.ramp(0);
    const dying = this.source;
    this.source = null;
    this.kind = "none";
    setTimeout(() => {
      try {
        dying.stop();
        dying.disconnect();
      } catch {
        // already stopped
      }
    }, 500);
  }

  private stopNow(): void {
    try {
      this.source?.stop();
      this.source?.disconnect();
    } catch {
      // already stopped
    }
    this.source = null;
  }

  close(): void {
    this.stopNow();
    this.buffers.clear();
    this.gain = null;
    this.ctx = null;
  }
}
