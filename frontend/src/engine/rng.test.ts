import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRng, deriveStream, hashStateSeed, standardNormalPairFromUniforms } from './rng';

const engineDir = dirname(fileURLToPath(import.meta.url));

describe('hashStateSeed', () => {
  it('does not collide across a length-boundary shift (the reason for length-framing)', () => {
    // A plain '|'-joined concatenation would make these two identical: 'a|bc' === 'ab|c'... but
    // they aren't the same string, so pick an actual collision-prone pair: same total characters,
    // different split points, joined with the empty string.
    const a = hashStateSeed(['a', 'bc']);
    const b = hashStateSeed(['ab', 'c']);
    expect(a).not.toBe(b);
  });

  it('does not collide when a part contains the delimiter character itself', () => {
    // If parts were joined with ':', ['a:b', 'c'] and ['a', 'b:c'] would concatenate identically.
    const a = hashStateSeed(['a:b', 'c']);
    const b = hashStateSeed(['a', 'b:c']);
    expect(a).not.toBe(b);
  });

  it('is deterministic for identical inputs', () => {
    const parts = ['draft-1', 'team-3', '17', 'overall:team:slot:player'];
    expect(hashStateSeed(parts)).toBe(hashStateSeed([...parts]));
  });

  it('is sensitive to input order (not just multiset)', () => {
    expect(hashStateSeed(['x', 'y'])).not.toBe(hashStateSeed(['y', 'x']));
  });

  it('handles the empty-parts case without throwing', () => {
    expect(() => hashStateSeed([])).not.toThrow();
  });
});

describe('deriveStream — prefix property', () => {
  it('scenario i is identical regardless of how many total scenarios are requested', () => {
    const baseSeed = hashStateSeed(['draft-1', 'team-3', '10']);
    // "Requesting more scenarios" doesn't change how index 5 is derived — deriveStream is a pure
    // function of (baseSeed, index), not an offset into a shared running stream.
    const five_of_10 = deriveStream(baseSeed, 5);
    const five_of_400 = deriveStream(baseSeed, 5);
    expect(five_of_10).toBe(five_of_400);
  });

  it('distinct scenario indices derive distinct seeds', () => {
    const baseSeed = hashStateSeed(['draft-1', 'team-3', '10']);
    const seeds = new Set(Array.from({ length: 50 }, (_, i) => deriveStream(baseSeed, i)));
    expect(seeds.size).toBe(50);
  });

  it('distinct base seeds derive distinct streams at the same index (no cross-base collision)', () => {
    const seedA = hashStateSeed(['draft-1', 'team-3', '10']);
    const seedB = hashStateSeed(['draft-2', 'team-3', '10']);
    expect(deriveStream(seedA, 0)).not.toBe(deriveStream(seedB, 0));
  });
});

describe('createRng', () => {
  it('is deterministic: identical seed produces an identical sequence', () => {
    const seed = deriveStream(hashStateSeed(['a', 'b']), 3);
    const rngA = createRng(seed);
    const rngB = createRng(seed);
    const sequenceA = Array.from({ length: 20 }, () => rngA.next());
    const sequenceB = Array.from({ length: 20 }, () => rngB.next());
    expect(sequenceA).toEqual(sequenceB);
  });

  it('different seeds produce different sequences', () => {
    const rngA = createRng(1n);
    const rngB = createRng(2n);
    const a = Array.from({ length: 10 }, () => rngA.next());
    const b = Array.from({ length: 10 }, () => rngB.next());
    expect(a).not.toEqual(b);
  });

  it('next() stays within [0, 1) over many draws', () => {
    const rng = createRng(hashStateSeed(['stress']));
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('standardNormal() never produces Infinity/NaN even when a draw lands exactly on 0', () => {
    // Directly force the legal u1===0 boundary; a seeded 32-bit PRNG reaches it only once per
    // ~4.3 billion draws, so sampling arbitrary seeds does not exercise this guard.
    const [first, second] = standardNormalPairFromUniforms(0, 0.25);
    expect(Number.isFinite(first)).toBe(true);
    expect(Number.isFinite(second)).toBe(true);
  });

  it('standardNormal() is approximately mean-0 stdev-1 over a large sample (sanity, not a strict statistical test)', () => {
    const rng = createRng(hashStateSeed(['normal-sanity']));
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i += 1) {
      const value = rng.standardNormal();
      sum += value;
      sumSq += value * value;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(variance - 1)).toBeLessThan(0.1);
  });

  it('standardNormal() is deterministic across two independently created streams from the same seed', () => {
    const seed = deriveStream(hashStateSeed(['normal-det']), 7);
    const a = createRng(seed);
    const b = createRng(seed);
    const seqA = Array.from({ length: 11 }, () => a.standardNormal()); // odd count exercises the cache
    const seqB = Array.from({ length: 11 }, () => b.standardNormal());
    expect(seqA).toEqual(seqB);
  });
});

describe('no Math.random under frontend/src/engine', () => {
  it('scans every .ts source file (excluding tests) for Math.random', () => {
    const offenders: string[] = [];
    for (const fileName of readdirSync(engineDir)) {
      if (!fileName.endsWith('.ts') || fileName.endsWith('.test.ts')) continue;
      const contents = readFileSync(join(engineDir, fileName), 'utf-8');
      if (contents.includes('Math.random')) offenders.push(fileName);
    }
    expect(offenders).toEqual([]);
  });
});
