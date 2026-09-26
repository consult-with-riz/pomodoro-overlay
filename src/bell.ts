/**
 * Bell synthesis, shared by live playback and the exported audio track.
 *
 * Additive synthesis rather than a sample, so the bell is a few lines of maths
 * instead of an asset to load, licence and ship. The partials are a struck
 * bell: a near-unison pair at C5 that beats slowly, an octave, a minor tenth,
 * and two short high partials for the strike transient.
 *
 * bellSample is pure, which is what lets the export render the same bell into
 * an AudioBuffer offline that the page plays live.
 */

/** Seconds. The tail is inaudible well before this, but it keeps the maths simple. */
export const BELL_LEN = 4.5;

interface Partial {
  /** Hz. */
  f: number;
  /** Relative amplitude. */
  a: number;
  /** Exponential decay time constant, in seconds. */
  d: number;
}

export type BellVariant = "bell" | "chime" | "knock" | "gong" | "none";

export const BELL_LABELS: Record<BellVariant, string> = {
  bell: "Bell",
  chime: "Chime",
  knock: "Wooden knock",
  gong: "Gong",
  none: "Silent",
};

/** The original struck bell: a near-unison pair at C5 that beats slowly. */
const BELL: Partial[] = [
  { f: 523.25, a: 0.5, d: 1.7 },
  { f: 526.1, a: 0.18, d: 1.4 },
  { f: 1046.5, a: 0.22, d: 0.95 },
  { f: 1444.2, a: 0.16, d: 0.6 },
  { f: 2825.5, a: 0.07, d: 0.3 },
  { f: 4672.6, a: 0.035, d: 0.15 },
];

/** Higher and plainer, closer to a desk bell. */
const CHIME: Partial[] = [
  { f: 880, a: 0.42, d: 1.1 },
  { f: 1760, a: 0.2, d: 0.7 },
  { f: 2640, a: 0.09, d: 0.35 },
  { f: 3520, a: 0.04, d: 0.18 },
];

/** Low and long, with an inharmonic spread so it shimmers rather than rings. */
const GONG: Partial[] = [
  { f: 110, a: 0.5, d: 3.4 },
  { f: 164.8, a: 0.28, d: 2.8 },
  { f: 233.1, a: 0.2, d: 2.2 },
  { f: 311.1, a: 0.14, d: 1.6 },
  { f: 466.2, a: 0.09, d: 1.0 },
  { f: 622.3, a: 0.05, d: 0.6 },
];

const PARTIALS: Record<"bell" | "chime" | "gong", Partial[]> = {
  bell: BELL,
  chime: CHIME,
  gong: GONG,
};

/**
 * Deterministic pseudo-noise.
 *
 * The knock is mostly a noise burst, but the exported audio has to be
 * reproducible frame for frame, so Math.random is not an option. This is a
 * cheap hash of the sample index, which gives the same sequence every time.
 */
function noiseAt(tau: number): number {
  const x = Math.sin(tau * 12_9898.0) * 43_758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Amplitude at `tau` seconds after the strike, for the chosen sound.
 * Outside the tail it is silent.
 */
export function bellSample(tau: number, variant: BellVariant = "bell"): number {
  if (variant === "none") return 0;
  if (tau < 0 || tau > BELL_LEN) return 0;

  // 4ms fade-in, otherwise the discontinuity at t=0 clicks.
  const attack = Math.min(1, tau / 0.004);

  if (variant === "knock") {
    // A wooden knock is a short thud plus a filtered click, not a ring, so it
    // is built from a decaying low sine and a very fast noise burst.
    const thud = 0.55 * Math.exp(-tau / 0.045) * Math.sin(2 * Math.PI * 184 * tau);
    const body = 0.22 * Math.exp(-tau / 0.03) * Math.sin(2 * Math.PI * 372 * tau);
    const click = 0.3 * Math.exp(-tau / 0.008) * noiseAt(tau);
    return attack * (thud + body + click) * 0.62;
  }

  let v = 0;
  for (const p of PARTIALS[variant]) {
    v += p.a * Math.exp(-tau / p.d) * Math.sin(2 * Math.PI * p.f * tau);
  }
  return attack * v * 0.62;
}

/** Fill a mono Float32Array with one bell, starting at sample 0. */
export function renderBell(
  out: Float32Array,
  sampleRate: number,
  variant: BellVariant = "bell"
): void {
  for (let i = 0; i < out.length; i++) out[i] = bellSample(i / sampleRate, variant);
}

/**
 * When the bell rings: the start of every segment except the lead-in.
 * The lead-in is the silent run-up before the session, so it gets no chime.
 */
export function bellTimes(tl: { segs: { kind: string; start: number }[] }): number[] {
  return tl.segs.filter((g) => g.kind !== "lead").map((g) => g.start);
}

/**
 * Live playback. Lazily builds one AudioContext and one pre-rendered buffer,
 * then fires cheap buffer sources off it.
 *
 * Browsers refuse to start audio without a gesture, so `unlock` is called from
 * the Start button rather than at load.
 */
export class BellPlayer {
  private ctx: AudioContext | null = null;
  /** One pre-rendered buffer per variant, built on first use. */
  private buffers = new Map<BellVariant, AudioBuffer>();
  private gain: GainNode | null = null;
  private volume = 0.8;

  /** Safe to call repeatedly; only the first call builds anything. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this.volume;
        this.gain.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** Expose the shared context so ambient noise can run on the same clock. */
  context(): AudioContext | null {
    return this.ctx;
  }

  private bufferFor(variant: BellVariant): AudioBuffer | null {
    if (!this.ctx) return null;
    const existing = this.buffers.get(variant);
    if (existing) return existing;
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * BELL_LEN), sr);
    renderBell(buf.getChannelData(0), sr, variant);
    this.buffers.set(variant, buf);
    return buf;
  }

  ring(variant: BellVariant = "bell"): void {
    if (variant === "none") return;
    this.unlock();
    const buffer = this.bufferFor(variant);
    if (!this.ctx || !buffer || !this.gain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    src.start();
  }

  close(): void {
    try {
      void this.ctx?.close();
    } catch {
      // already closed
    }
    this.ctx = null;
    this.gain = null;
    this.buffers.clear();
  }
}
