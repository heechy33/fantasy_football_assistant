import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { InjuryBodyPartHistory, PlayerUsageArtifact } from '../../../shared/types';
import {
  buildBodyMapModel,
  isUnlocalizedLabel,
  resolveBodyRegion,
  splitBodyPartLabel,
} from './injuryBodyMap';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
const usagePath = join(dataDir, 'player-usage.json');

function report(season: number, week: number, label: string) {
  return { season, week, labels: [label] };
}

describe('splitBodyPartLabel', () => {
  it('returns a single-element array for a label with no comma', () => {
    expect(splitBodyPartLabel('hamstring')).toEqual(['hamstring']);
  });

  it('splits a compound label on the comma separator', () => {
    expect(splitBodyPartLabel('hamstring, abdomen')).toEqual(['hamstring', 'abdomen']);
    expect(splitBodyPartLabel('right shoulder, rib')).toEqual(['right shoulder', 'rib']);
    expect(splitBodyPartLabel('knee, illness')).toEqual(['knee', 'illness']);
  });
});

describe('isUnlocalizedLabel', () => {
  it('flags administrative and illness labels', () => {
    expect(isUnlocalizedLabel('illness')).toBe(true);
    expect(isUnlocalizedLabel('cramps')).toBe(true);
    expect(isUnlocalizedLabel('coach decision')).toBe(true);
    expect(isUnlocalizedLabel("coach's decision")).toBe(true);
    expect(isUnlocalizedLabel('jury duty')).toBe(true);
    expect(isUnlocalizedLabel('returning from suspension')).toBe(true);
    expect(isUnlocalizedLabel('gameday concussion protocol evaluation')).toBe(true);
  });

  it('flags prose asides purely by length', () => {
    const prose =
      'concussion. tremble has cleared concussion protocol. his game status is a result of a back injury.';
    expect(prose.length).toBeGreaterThan(40);
    expect(isUnlocalizedLabel(prose)).toBe(true);
  });

  it('does not flag ordinary body-part labels', () => {
    expect(isUnlocalizedLabel('knee')).toBe(false);
    expect(isUnlocalizedLabel('left hamstring')).toBe(false);
    expect(isUnlocalizedLabel('concussion')).toBe(false);
  });
});

describe('resolveBodyRegion', () => {
  it('resolves a plain label with no side prefix', () => {
    expect(resolveBodyRegion('hamstring')).toEqual({ region: 'thigh', side: 'unspecified' });
    expect(resolveBodyRegion('knee')).toEqual({ region: 'knee', side: 'unspecified' });
  });

  it('resolves a left/right prefixed label', () => {
    expect(resolveBodyRegion('left knee')).toEqual({ region: 'knee', side: 'left' });
    expect(resolveBodyRegion('right shoulder')).toEqual({ region: 'shoulder', side: 'right' });
  });

  it('strips a trailing parenthetical annotation before matching', () => {
    expect(resolveBodyRegion('right arm (laceration)')).toEqual({ region: 'forearm', side: 'right' });
  });

  it('returns null for an unrecognized part', () => {
    expect(resolveBodyRegion('spleen')).toBeNull();
  });

  it('strips a leading ordinal-injury-count prefix before matching', () => {
    expect(resolveBodyRegion('third injury: ankle')).toEqual({ region: 'ankle', side: 'unspecified' });
  });

  it('folds hernia onto abdomen', () => {
    expect(resolveBodyRegion('hernia')).toEqual({ region: 'abdomen', side: 'unspecified' });
  });
});

describe('buildBodyMapModel', () => {
  it('splits a compound label across two regions, both carrying the same episodes/reports', () => {
    const history: InjuryBodyPartHistory[] = [
      {
        normalizedBodyPart: 'hamstring, abdomen',
        episodes: 2,
        recurring: false,
        reports: [report(2025, 6, 'Hamstring'), report(2025, 6, 'Abdomen')],
      },
    ];
    const model = buildBodyMapModel(history);
    expect(model.unlocalized).toEqual([]);
    expect(model.regions).toHaveLength(2);
    const thigh = model.regions.find((r) => r.region === 'thigh');
    const abdomen = model.regions.find((r) => r.region === 'abdomen');
    expect(thigh).toMatchObject({ side: 'unspecified', episodes: 2, recurring: false, heat: 2 });
    expect(abdomen).toMatchObject({ side: 'unspecified', episodes: 2, recurring: false, heat: 2 });
  });

  it('routes the localizable part of a mixed label to a region and the rest to unlocalized', () => {
    const history: InjuryBodyPartHistory[] = [
      { normalizedBodyPart: 'knee, illness', episodes: 1, recurring: false, reports: [report(2024, 3, 'Knee')] },
    ];
    const model = buildBodyMapModel(history);
    expect(model.regions).toHaveLength(1);
    expect(model.regions[0]).toMatchObject({ region: 'knee', side: 'unspecified' });
    expect(model.unlocalized).toEqual([{ label: 'illness', episodes: 1 }]);
  });

  it('never drops an unrecognized label — it surfaces in unlocalized rather than vanishing', () => {
    const history: InjuryBodyPartHistory[] = [
      { normalizedBodyPart: 'spleen', episodes: 1, recurring: false, reports: [] },
    ];
    const model = buildBodyMapModel(history);
    expect(model.regions).toEqual([]);
    expect(model.unlocalized).toEqual([{ label: 'spleen', episodes: 1 }]);
  });

  it('merges two entries that resolve to the same region and side', () => {
    const history: InjuryBodyPartHistory[] = [
      { normalizedBodyPart: 'left knee', episodes: 1, recurring: false, reports: [report(2023, 4, 'Knee')] },
      { normalizedBodyPart: 'left knee', episodes: 1, recurring: false, reports: [report(2025, 8, 'Knee')] },
    ];
    const model = buildBodyMapModel(history);
    expect(model.regions).toHaveLength(1);
    expect(model.regions[0]).toMatchObject({ region: 'knee', side: 'left', episodes: 2, reports: expect.arrayContaining([
      report(2023, 4, 'Knee'),
      report(2025, 8, 'Knee'),
    ]) });
  });

  it.each([
    [1, false, 1],
    [2, false, 2],
    [3, false, 3],
    [5, false, 3],
    [1, true, 3],
  ])('buckets heat for %i episode(s), recurring=%s -> %i', (episodes, recurring, expectedHeat) => {
    const history: InjuryBodyPartHistory[] = [
      { normalizedBodyPart: 'ankle', episodes, recurring, reports: [] },
    ];
    const model = buildBodyMapModel(history);
    expect(model.regions[0]!.heat).toBe(expectedHeat);
  });
});

describe('real data: every normalizedBodyPart label in the committed artifact resolves', () => {
  const hasUsageArtifact = existsSync(usagePath);

  it.skipIf(!hasUsageArtifact)('classifies all observed labels with zero falling through unclassified', () => {
    const usage = JSON.parse(readFileSync(usagePath, 'utf-8')) as PlayerUsageArtifact;
    const labels = new Set<string>();
    for (const record of Object.values(usage)) {
      for (const entry of record.injuryHistory ?? []) {
        labels.add(entry.normalizedBodyPart);
      }
    }
    expect(labels.size).toBeGreaterThan(0);

    const unclassified: string[] = [];
    for (const label of labels) {
      for (const part of splitBodyPartLabel(label)) {
        if (isUnlocalizedLabel(part)) continue;
        if (resolveBodyRegion(part) == null) unclassified.push(`${label} -> ${part}`);
      }
    }
    expect(unclassified).toEqual([]);
  });

  it.skipIf(!hasUsageArtifact)('buildBodyMapModel never drops a label for any real player', () => {
    const usage = JSON.parse(readFileSync(usagePath, 'utf-8')) as PlayerUsageArtifact;
    for (const record of Object.values(usage)) {
      const history = record.injuryHistory ?? [];
      if (history.length === 0) continue;
      const model = buildBodyMapModel(history);
      // Every atomic part either merges into a region (regions can merge, so this count can be
      // smaller than the input part count) or is listed individually in unlocalized (which never
      // merges) — so unlocalized alone can never exceed the total number of atomic parts, and a
      // player with any localizable history must produce at least one region.
      const expectedPartCount = history.reduce((sum, e) => sum + splitBodyPartLabel(e.normalizedBodyPart).length, 0);
      expect(model.unlocalized.length).toBeLessThanOrEqual(expectedPartCount);
      if (model.unlocalized.length < expectedPartCount) {
        expect(model.regions.length).toBeGreaterThan(0);
      }
    }
  });
});
