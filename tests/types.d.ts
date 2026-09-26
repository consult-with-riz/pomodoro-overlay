/**
 * pixelmatch ships no types and has no @types package, so the one call the
 * golden test makes is declared here rather than casting it to any at the
 * call site.
 */
declare module "pixelmatch" {
  interface PixelmatchOptions {
    threshold?: number;
    includeAA?: boolean;
    alpha?: number;
    aaColor?: [number, number, number];
    diffColor?: [number, number, number];
    diffColorAlt?: [number, number, number];
    diffMask?: boolean;
  }

  /** Returns the number of differing pixels. */
  export default function pixelmatch(
    img1: Uint8Array | Uint8ClampedArray,
    img2: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray | null,
    width: number,
    height: number,
    options?: PixelmatchOptions
  ): number;
}

/** Plain-JS helper shared between the capture script and the tests. */
declare module "*/golden-cases.mjs" {
  import type { Settings } from "../src/settings";

  export interface GoldenCase {
    name: string;
    t: number;
    settings?: Partial<Settings>;
  }

  export const BASE: Settings;
  export const CASES: GoldenCase[];
  export const WIDTH: number;
  export const HEIGHT: number;
  export function settingsFor(testCase: { settings?: Partial<Settings> }): Settings;
}
