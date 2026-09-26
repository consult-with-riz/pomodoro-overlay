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

const PARTIALS: Partial[] = [
  { f: 523.25, a: 0.5, d: 1.7 },
  { f: 526.1, a: 0.18, d: 1.4 },
  { f: 1046.5, a: 0.22, d: 0.95 },
  { f: 1444.2, a: 0.16, d: 0.6 },
  { f: 2825.5, a: 0.07, d: 0.3 },
  { f: 4672.6, a: 0.035, d: 0.15 },
];

/** Amplitude at `tau` seconds after the strike. Outside the tail it is silent. */
export function bellSample(tau: number): number {
  if (tau < 0 || tau > BELL_LEN) return 0;
  // 4ms fade-in, otherwise the discontinuity at t=0 clicks.
  const attack = Math.min(1, tau / 0.004);
  let v = 0;
  for (const p of PARTIALS) {
    v += p.a * Math.exp(-tau / p.d) * Math.sin(2 * Math.PI * p.f * tau);
  }
  return attack * v * 0.62;
}

/** Fill a mono Float32Array with one bell, starting at sample 0. */
export function renderBell(out: Float32Array, sampleRate: number): void {
  for (let i = 0; i < out.length; i++) out[i] = bellSample(i / sampleRate);
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
  private buffer: AudioBuffer | null = null;

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
        const sr = this.ctx.sampleRate;
        this.buffer = this.ctx.createBuffer(1, Math.floor(sr * BELL_LEN), sr);
        renderBell(this.buffer.getChannelData(0), sr);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  ring(): void {
    this.unlock();
    if (!this.ctx || !this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    src.start();
  }

  close(): void {
    try {
      void this.ctx?.close();
    } catch {
      // already closed
    }
    this.ctx = null;
    this.buffer = null;
  }
}
