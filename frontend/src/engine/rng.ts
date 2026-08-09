/**
 * Seeded, deterministic randomness for S3's rollout engine. Everything here is `BigInt`-native —
 * FNV-1a, SplitMix64, and PCG32 are all specified as 64-bit operations, and a `number`-based port
 * would silently lose precision above 2^53, degrading the stream's effective period without any
 * visible error. See PLAN.md's S3 stage-B note.
 *
 * No file under `frontend/src/engine/` may call the built-in non-seeded random source — every
 * source of randomness in the simulation must be traceable to a `Seed` so a recommendation board is
 * reproducible from `(draftId, myTeamId, decisionPick, picksSignature)` alone.
 */

/** Opaque 64-bit seed/state value. Never surfaced to the UI — only ever threaded between the
 * functions in this module. */
export type Seed = bigint;

const MASK64 = 0xFFFFFFFFFFFFFFFFn;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const SPLITMIX64_INCREMENT = 0x9E3779B97F4A7C15n;
const PCG32_MULTIPLIER = 6364136223846793005n;

/**
 * FNV-1a over length-framed parts (`${part.length}:${part}`) so that, e.g., `hashStateSeed(['a',
 * 'bc'])` and `hashStateSeed(['ab', 'c'])` cannot collide by having their parts concatenate to the
 * same byte stream — a plain join (with or without a delimiter character) can't rule that out in
 * general, since the delimiter itself could appear inside a part (a Sleeper `draftId`/`teamId` is
 * an opaque string, not guaranteed free of any particular character).
 *
 * Inputs in production are `draftId`, `myTeamId`, `decisionPick` (stringified), and the canonical
 * `picksSignature` (see `adapters/draftOrder.ts`) — together these pin the seed to the exact draft
 * state a recommendation board was computed from.
 */
export function hashStateSeed(parts: readonly string[]): Seed {
  let hash = FNV_OFFSET_BASIS_64;
  for (const part of parts) {
    const framed = `${part.length}:${part}`;
    for (let i = 0; i < framed.length; i += 1) {
      hash ^= BigInt(framed.charCodeAt(i));
      hash = (hash * FNV_PRIME_64) & MASK64;
    }
  }
  return hash;
}

/** One SplitMix64 step: given the current generator state, returns the next state and the mixed
 * output value derived from it. Used both as PCG32's seeding procedure (the standard
 * "seed a small PRNG's state well from a single 64-bit seed" trick) and, here, to derive
 * per-scenario seeds. */
function splitMix64Step(state: Seed): { value: Seed; nextState: Seed } {
  const nextState = (state + SPLITMIX64_INCREMENT) & MASK64;
  let z = nextState;
  z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK64;
  z = z ^ (z >> 31n);
  return { value: z, nextState };
}

/**
 * Derives scenario `scenarioIndex`'s seed from `baseSeed`, independent of how many total scenarios
 * are (or will be) requested — this prefix property is what makes a truncated/budgeted run's
 * completed scenarios identical to the same-indexed scenarios in a longer or `'fixed'`-mode run
 * with the same `baseSeed`. Pure function of `(baseSeed, scenarioIndex)`: no shared mutable stream
 * state, so scenario 5 is never "whatever the generator happened to be at after 4 prior draws."
 */
export function deriveStream(baseSeed: Seed, scenarioIndex: number): Seed {
  const offsetState = (baseSeed + BigInt(scenarioIndex) * SPLITMIX64_INCREMENT) & MASK64;
  return splitMix64Step(offsetState).value;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Standard normal (mean 0, stdev 1) via Box–Muller. */
  standardNormal(): number;
}

/** Box-Muller transform with the exact-zero guard used by `createRng`. Exported so the legal
 * `u1 === 0` boundary can be tested directly instead of relying on an astronomically unlikely
 * PRNG draw. */
export function standardNormalPairFromUniforms(u1: number, u2: number): readonly [number, number] {
  const safeU1 = u1 === 0 ? Number.EPSILON : u1;
  const radius = Math.sqrt(-2 * Math.log(safeU1));
  const theta = 2 * Math.PI * u2;
  return [radius * Math.cos(theta), radius * Math.sin(theta)];
}

/** One PCG32 (XSH-RR) step. Reference: O'Neill, "PCG: A Family of Simple Fast Space-Efficient
 * Statistically Good Algorithms for Random Number Generation" — the minimal C reference
 * implementation's `pcg32_random_r`. */
function pcg32NextU32(state: Seed, inc: Seed): { value: number; nextState: Seed } {
  const nextState = (state * PCG32_MULTIPLIER + inc) & MASK64;
  const xorshifted = Number(((state ^ (state >> 18n)) >> 27n) & 0xFFFFFFFFn);
  const rot = Number(state >> 59n);
  // rotr32(xorshifted, rot). `(-rot) & 31` (rather than `32 - rot`) keeps the rot===0 case correct:
  // a JS `<<` shift amount is taken mod 32, so `xorshifted << 32` would silently become `<< 0` and
  // double-count the low bits instead of contributing nothing.
  const value = ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  return { value, nextState };
}

/** PCG32's own seeding procedure (`pcg32_srandom_r`): run one step from a zero state to mix in the
 * stream constant, add the seed, then step again. */
function pcg32Seed(seedValue: Seed, streamSeq: Seed): { state: Seed; inc: Seed } {
  const inc = ((streamSeq << 1n) | 1n) & MASK64;
  let state = pcg32NextU32(0n, inc).nextState;
  state = (state + seedValue) & MASK64;
  state = pcg32NextU32(state, inc).nextState;
  return { state, inc };
}

/**
 * Creates an independent, stateful random stream from a `Seed`. Two `createRng(seed)` calls with
 * the same seed produce byte-identical sequences; different seeds (including two `deriveStream`
 * outputs for different scenario indices) are independent streams, not offsets of one another.
 */
export function createRng(seed: Seed): Rng {
  // SplitMix64-seed the PCG32 state/increment pair from the single input seed — the standard way
  // to turn one seed into a well-mixed small-PRNG state rather than using it as raw state directly.
  const first = splitMix64Step(seed);
  const second = splitMix64Step(first.nextState);
  let pcg = pcg32Seed(first.value, second.value);
  let cachedNormal: number | null = null;

  function next(): number {
    const result = pcg32NextU32(pcg.state, pcg.inc);
    pcg = { state: result.nextState, inc: pcg.inc };
    return result.value / 4294967296; // 2^32 — [0, 1)
  }

  function standardNormal(): number {
    // Box-Muller produces two independent standard normals per pair of uniforms; cache the second
    // instead of discarding it.
    if (cachedNormal != null) {
      const value = cachedNormal;
      cachedNormal = null;
      return value;
    }
    const [first, second] = standardNormalPairFromUniforms(next(), next());
    cachedNormal = second;
    return first;
  }

  return { next, standardNormal };
}
