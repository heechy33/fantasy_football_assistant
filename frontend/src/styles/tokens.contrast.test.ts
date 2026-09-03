import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Real deterministic accessibility gate over tokens.css's core ramp — not a smoke test. Until
// this file existed, the ratios in tokens.css's header comment were asserted in prose only, and
// the prose drifted (it cited a pre-2026-08-26 --surface-2/-3 pair for years after the values
// moved — see teamColors.test.ts's own history). Parsing the real token values means this can't
// happen again the same way.

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'tokens.css');
const css = readFileSync(cssPath, 'utf-8');

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Reads a literal `#rrggbb` custom-property value out of tokens.css. Only matches the FIRST
 * declaration of a given name — every token below is declared exactly once in the flat :root
 * block, so this is unambiguous. */
function readHexVar(name: string): string {
  const match = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`tokens.css is missing hex custom property ${name}`);
  return match[1]!;
}

function readRgb(name: string): [number, number, number] {
  return hexToRgb(readHexVar(name));
}

const SURFACE_0 = readRgb('--surface-0');
const SURFACE_2 = readRgb('--surface-2');
const SURFACE_3 = readRgb('--surface-3');

describe('tokens.css text ramp', () => {
  it.each(['--text-1', '--text-2', '--text-3', '--text-4', '--text-muted'] as const)(
    '%s clears WCAG AA 4.5:1 on surface-0, surface-2, and surface-3',
    (name) => {
      const text = readRgb(name);
      expect(contrastRatio(text, SURFACE_0)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(text, SURFACE_2)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(text, SURFACE_3)).toBeGreaterThanOrEqual(4.5);
    },
  );

  // The halation/ghosting ceiling: on a near-black ground with a saturated accent elsewhere on
  // screen, text much brighter than ~15:1 causes visible glow/bleed around glyphs (worse for the
  // ~1-in-3 people with astigmatism) and afterimage trailing on scroll. Nothing in the WCAG 2
  // toolchain checks an upper bound — this is the one novel assertion in this file, and it's what
  // let --text-1 ship at 16.9:1 for as long as it did.
  it('--text-1 stays under the 15:1 halation ceiling on --surface-0', () => {
    const text1 = readRgb('--text-1');
    expect(contrastRatio(text1, SURFACE_0)).toBeLessThanOrEqual(15);
  });
});

describe('tokens.css --accent-cool family', () => {
  it.each(['--accent-cool', '--accent-cool-quiet', '--accent-cool-bright'] as const)(
    '%s clears WCAG AA 4.5:1 (text role) on surface-0 and surface-2',
    (name) => {
      const accent = readRgb(name);
      expect(contrastRatio(accent, SURFACE_0)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accent, SURFACE_2)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('--accent-cool-quiet clears the WCAG 2.2 1.4.11 3:1 non-text floor on surface-0 and surface-2 (its hairline/stroke role)', () => {
    const quiet = readRgb('--accent-cool-quiet');
    expect(contrastRatio(quiet, SURFACE_0)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(quiet, SURFACE_2)).toBeGreaterThanOrEqual(3.0);
  });

  it('--accent-cool-ink clears 4.5:1 on --accent-cool (text-on-chip)', () => {
    const ink = readRgb('--accent-cool-ink');
    const accentCool = readRgb('--accent-cool');
    expect(contrastRatio(ink, accentCool)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('tokens.css orange --accent', () => {
  it('--text-ink clears 4.5:1 on --accent (text-on-chip)', () => {
    const textInk = readRgb('--text-ink');
    const accent = readRgb('--accent');
    expect(contrastRatio(textInk, accent)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('tokens.css functional borders', () => {
  it.each(['--border-1', '--border-2', '--border-3'] as const)(
    '%s clears the WCAG 2.2 1.4.11 3:1 non-text floor on both surface-2 and surface-3',
    (name) => {
      const border = readRgb(name);
      expect(contrastRatio(border, SURFACE_2)).toBeGreaterThanOrEqual(3.0);
      expect(contrastRatio(border, SURFACE_3)).toBeGreaterThanOrEqual(3.0);
    },
  );
});
