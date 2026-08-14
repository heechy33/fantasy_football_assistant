import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Real deterministic accessibility gate over teamColors.css — not a smoke test. Parses the CSS
// source (jsdom doesn't evaluate color-mix()/CSS custom properties, so this asserts computed WCAG
// ratios directly against the hex values, mirroring what color-mix(in srgb, ...) would produce —
// componentwise sRGB interpolation is exactly reproducible in plain arithmetic).

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'teamColors.css');
const css = readFileSync(cssPath, 'utf-8');

const EXPECTED_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND',
  'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF',
  'TB', 'TEN', 'WAS', 'FA',
] as const;

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

/** color-mix(in srgb, a p%, b) is componentwise linear interpolation in sRGB space. */
function mix(a: [number, number, number], b: [number, number, number], pctA: number): [number, number, number] {
  return [
    a[0] * pctA + b[0] * (1 - pctA),
    a[1] * pctA + b[1] * (1 - pctA),
    a[2] * pctA + b[2] * (1 - pctA),
  ];
}

const SURFACE_2 = hexToRgb('#17191c');
const SURFACE_3 = hexToRgb('#1b1d21');
const TEXT_1 = hexToRgb('#ececec');
const TEXT_3 = hexToRgb('#b4b4b4');
const TEAM_TINT = 0.18;

const tokensPath = join(dirname(fileURLToPath(import.meta.url)), 'tokens.css');
const tokensCss = readFileSync(tokensPath, 'utf-8');

function readPercentVar(source: string, name: string): number {
  const match = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*([0-9.]+)%`).exec(source);
  if (!match) throw new Error(`missing percentage custom property ${name}`);
  return Number(match[1]) / 100;
}

const PLAYER_CARD_CONTENT_TINT = readPercentVar(tokensCss, '--player-card-content-tint');

function readVar(name: string): string {
  const match = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`teamColors.css is missing custom property ${name}`);
  return match[1]!;
}

describe('teamColors.css', () => {
  it('defines exactly the 32 Sleeper team abbreviations plus FA', () => {
    for (const team of EXPECTED_TEAMS) {
      expect(css).toContain(`[data-team="${team}"]`);
    }
    expect(EXPECTED_TEAMS.length).toBe(33);
  });

  it.each(EXPECTED_TEAMS)('%s: 18%% tint of --team-primary keeps body text readable', (team) => {
    const lower = team.toLowerCase();
    const primary = hexToRgb(readVar(`--team-${lower}`));
    const tinted = mix(primary, SURFACE_3, TEAM_TINT);
    expect(contrastRatio(tinted, TEXT_1)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tinted, TEXT_3)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(EXPECTED_TEAMS)('%s: player-card content-zone tint keeps body text readable on surface-2', (team) => {
    const lower = team.toLowerCase();
    const primary = hexToRgb(readVar(`--team-${lower}`));
    const tinted = mix(primary, SURFACE_2, PLAYER_CARD_CONTENT_TINT);
    expect(contrastRatio(tinted, TEXT_1)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tinted, TEXT_3)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(EXPECTED_TEAMS)('%s: --team-ink clears 4.5:1 on both surface-2 and surface-3', (team) => {
    const lower = team.toLowerCase();
    const ink = hexToRgb(readVar(`--team-${lower}-ink`));
    expect(contrastRatio(ink, SURFACE_2)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink, SURFACE_3)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(EXPECTED_TEAMS)('%s: --team-ink clears the 3:1 non-text UI floor on surface-3 (WCAG 1.4.11)', (team) => {
    const lower = team.toLowerCase();
    const ink = hexToRgb(readVar(`--team-${lower}-ink`));
    expect(contrastRatio(ink, SURFACE_3)).toBeGreaterThanOrEqual(3.0);
  });

  it('each [data-team="XX"] block sets both --team-primary and --team-ink', () => {
    for (const team of EXPECTED_TEAMS) {
      const blockMatch = new RegExp(`\\[data-team="${team}"\\]\\s*\\{([^}]*)\\}`).exec(css);
      expect(blockMatch, `missing [data-team="${team}"] block`).not.toBeNull();
      const body = blockMatch![1];
      expect(body).toContain('--team-primary:');
      expect(body).toContain('--team-ink:');
    }
  });
});
