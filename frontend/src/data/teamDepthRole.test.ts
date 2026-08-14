import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, OpportunityPeriod, PlayerMeta, PlayerUsage, PlayerUsageArtifact } from '../../../shared/types';
import {
  buildTeamDepthRoles,
  classifyRoomShape,
  depthRoleVolume,
  UNKNOWN_DEPTH_ROLE,
  visibleDepthMembers,
  type DepthRoleMember,
  type TeamDepthRole,
} from './teamDepthRole';

function player(overrides: Partial<PlayerMeta> = {}): PlayerMeta {
  return {
    playerId: 'p', name: 'Player', position: 'RB', eligiblePositions: ['RB'],
    team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
    ...overrides,
  };
}

function period(overrides: Partial<OpportunityPeriod> = {}): OpportunityPeriod {
  return {
    season: 2025, games: 0, targets: 0, carries: 0, touches: 0,
    targetsPerGame: null, carriesPerGame: null, touchesPerGame: null,
    targetShare: null, carryShare: null, airYards: null, airYardsPerGame: null,
    airYardsShare: null, receivingYardsAfterCatch: null, redZoneTargets: null,
    endZoneTargets: null, goalLineCarries: null, snapPct: null,
    ...overrides,
  };
}

function usageFor(input: {
  team?: string;
  carryShare?: number | null;
  targetShare?: number | null;
  snapPct?: number | null;
  games?: number | null;
  touchesPerGame?: number | null;
  airYardsShare?: number | null;
} = {}): PlayerUsage {
  return {
    season: 2025, usageSeasonObserved: true,
    snapPct: input.snapPct ?? null,
    targetShare: input.targetShare ?? null,
    carryShare: input.carryShare ?? null,
    gamesWithAnySnap: input.games ?? 0,
    recentTeam: input.team ?? 'BUF',
    teamChanged: false, knownAbsent: false, availabilityRate: null,
    seasons: [], injuryHistory: [], durabilityScore: null,
    opportunity: {
      season: period({
        games: input.games ?? 0,
        carryShare: input.carryShare ?? null,
        targetShare: input.targetShare ?? null,
        touchesPerGame: input.touchesPerGame ?? null,
        airYardsShare: input.airYardsShare ?? null,
        snapPct: input.snapPct ?? null,
      }),
      finalFive: null,
      roleEvolution: { targetsPerGameDelta: null, targetShareDelta: null, airYardsShareDelta: null, touchesPerGameDelta: null },
    },
  };
}

function member(overrides: Partial<DepthRoleMember> = {}): DepthRoleMember {
  return {
    playerId: 'a', name: 'A', slot: 1, share: null, secondary: null, measuredTeam: 'BUF',
    depthChartOrder: null, depthChartPosition: null, basis: 'volume',
    ...overrides,
  };
}

describe('depthRoleVolume', () => {
  it('reads carry share (RB), target share (WR/TE), and snap-games (QB = snapPct x games)', () => {
    expect(depthRoleVolume('RB', usageFor({ carryShare: 0.28 }))).toBeCloseTo(0.28, 10);
    expect(depthRoleVolume('WR', usageFor({ targetShare: 0.2 }))).toBeCloseTo(0.2, 10);
    expect(depthRoleVolume('TE', usageFor({ targetShare: 0.1 }))).toBeCloseTo(0.1, 10);
    // Snap-games, not the raw appearance rate: 14 games at 0.5 snap share.
    expect(depthRoleVolume('QB', usageFor({ snapPct: 0.5, games: 14 }))).toBeCloseTo(7, 10);
  });

  it('returns null for missing usage, K/DEF, and non-finite values', () => {
    expect(depthRoleVolume('RB', undefined)).toBeNull();
    expect(depthRoleVolume('QB', undefined)).toBeNull();
    expect(depthRoleVolume('K', usageFor())).toBeNull();
    expect(depthRoleVolume('DEF', usageFor())).toBeNull();
    expect(depthRoleVolume('QB', usageFor({ snapPct: 0.5, games: 0 }))).toBeNull();
  });
});

describe('classifyRoomShape RB gap boundaries', () => {
  // Exercises the two RB thresholds (committeeGap 0.10, splitGap 0.25) from both sides. Values are
  // chosen to be float-safe (0.5 - 0.4 would under-read as < 0.10, so the split case uses 0.39).
  it.each([
    [0.405, 'committee'], // gap 0.095 < 0.10
    [0.39, 'split'],      // 0.10 <= gap 0.11 < 0.25
    [0.26, 'split'],      // gap 0.24 < 0.25
    [0.24, 'clear'],      // gap 0.26 >= 0.25
  ])('lead share .50 vs %s carry share -> %s', (share2, expected) => {
    const { shape } = classifyRoomShape('RB', [
      member({ share: 0.5, depthChartOrder: 1 }),
      member({ playerId: 'b', name: 'B', slot: 2, share: share2 as number, depthChartOrder: 2 }),
    ]);
    expect(shape).toBe(expected);
  });

  it('leadFloor fires at .24 carry share (no established lead -> committee regardless of gap)', () => {
    const { shape, topGap } = classifyRoomShape('RB', [
      member({ share: 0.24, depthChartOrder: 1 }),
      member({ playerId: 'b', name: 'B', slot: 2, share: 0.05, depthChartOrder: 2 }),
    ]);
    expect(shape).toBe('committee');
    expect(topGap).toBeCloseTo(0.19, 10);
  });
});

describe('classifyRoomShape QB battle', () => {
  it('is battle at a .19 snap-games gap but clear at .21', () => {
    const tight = classifyRoomShape('QB', [
      member({ share: 0.6, depthChartOrder: 1 }),
      member({ playerId: 'b', name: 'B', slot: 2, share: 0.41, depthChartOrder: 2 }),
    ]);
    expect(tight.shape).toBe('battle');
    const wide = classifyRoomShape('QB', [
      member({ share: 0.6, depthChartOrder: 1 }),
      member({ playerId: 'b', name: 'B', slot: 2, share: 0.39, depthChartOrder: 2 }),
    ]);
    expect(wide.shape).toBe('clear');
  });

  it('is never battle when the #2 share is below .25 even with a tight gap', () => {
    const { shape } = classifyRoomShape('QB', [
      member({ share: 0.4, depthChartOrder: 1 }),
      member({ playerId: 'b', name: 'B', slot: 2, share: 0.22, depthChartOrder: 2 }),
    ]);
    expect(shape).toBe('clear');
  });

  it('is never battle when contested (the CIN/WAS regression: Flacco out-snapped Burrow)', () => {
    const { shape, topGap } = classifyRoomShape('QB', [
      member({ playerId: 'burrow', share: 0.44, depthChartOrder: 1 }),
      member({ playerId: 'flacco', name: 'Flacco', slot: 2, share: 0.56, depthChartOrder: 2 }),
    ]);
    expect(topGap).toBeCloseTo(0.12, 10);
    expect(shape).toBe('clear');
  });
});

describe('buildTeamDepthRoles', () => {
  it('slots a measured RB by volume share, not depth chart (RB primary = carry share)', () => {
    const roles = buildTeamDepthRoles(
      [
        player({ playerId: 'b', name: 'B', depthChartOrder: 1 }),
        player({ playerId: 'a', name: 'A', depthChartOrder: 2 }),
      ],
      {
        b: usageFor({ carryShare: 0.2 }),
        a: usageFor({ carryShare: 0.5 }),
      },
    );
    expect(roles.get('a')!.slot).toBe(1);
    expect(roles.get('b')!.slot).toBe(2);
    expect(roles.get('a')!.label).toBe('RB1');
    expect(roles.get('a')!.basis).toBe('volume');
  });

  it('slots a QB by depth chart (QB primary = depthChartOrder): Burrow stays QB1 over Flacco', () => {
    const roles = buildTeamDepthRoles(
      [
        player({ playerId: 'burrow', position: 'QB', eligiblePositions: ['QB'], name: 'Burrow', depthChartOrder: 1 }),
        player({ playerId: 'flacco', position: 'QB', eligiblePositions: ['QB'], name: 'Flacco', depthChartOrder: 2 }),
      ],
      {
        burrow: usageFor({ team: 'CIN', snapPct: 0.4, games: 10 }),
        flacco: usageFor({ team: 'CIN', snapPct: 0.5, games: 10 }),
      },
    );
    const room = roles.get('burrow')!.room!;
    expect(room.contested).toBe(true);
    expect(roles.get('burrow')!.slot).toBe(1);
    expect(roles.get('flacco')!.slot).toBe(2);
    // The snap-games share still drives shape honesty: contested -> never Battle.
    expect(room.shape).toBe('clear');
  });

  it('ranks two equal-snapPct QBs by games played (pins the snap-games correction)', () => {
    const roles = buildTeamDepthRoles(
      [
        player({ playerId: 'a', position: 'QB', eligiblePositions: ['QB'], name: 'A', team: 'KC' }),
        player({ playerId: 'b', position: 'QB', eligiblePositions: ['QB'], name: 'B', team: 'KC' }),
      ],
      {
        a: usageFor({ team: 'KC', snapPct: 0.5, games: 14 }),
        b: usageFor({ team: 'KC', snapPct: 0.5, games: 3 }),
      },
    );
    // Neither QB has a depthChartOrder, so the secondary (snap-games share) alone orders them:
    // 14 games x 0.5 = 7 snap-games vs 3 x 0.5 = 1.5 -> normalized .824/.176.
    expect(roles.get('a')!.slot).toBe(1);
    expect(roles.get('b')!.slot).toBe(2);
    expect(roles.get('a')!.room!.members[0]!.share).toBeCloseTo(0.8235294117647058, 10);
  });

  it('interleaves an unmeasured depthChartOrder: 2 RB at slot 2 after the measured leader', () => {
    const roles = buildTeamDepthRoles(
      [
        player({ playerId: 'lead', name: 'Lead', depthChartOrder: 1 }),
        player({ playerId: 'rookie', name: 'Rookie', depthChartOrder: 2 }),
      ],
      {
        lead: usageFor({ carryShare: 0.5 }),
        // rookie intentionally has no usage row at all.
      },
    );
    expect(roles.get('lead')!.slot).toBe(1);
    expect(roles.get('rookie')!.slot).toBe(2);
    expect(roles.get('rookie')!.basis).toBe('depth-chart');
    expect(roles.get('rookie')!.label).toBe('RB2');
  });

  it('keeps duplicate depthChartOrder (DET WRs both 6) deterministic and share-ordered', () => {
    const players = [
      player({ playerId: 'wrB', name: 'WR B', position: 'WR', eligiblePositions: ['WR'], depthChartOrder: 6 }),
      player({ playerId: 'wrA', name: 'WR A', position: 'WR', eligiblePositions: ['WR'], depthChartOrder: 6 }),
    ];
    const usage = {
      wrA: usageFor({ team: 'DET', targetShare: 0.25 }),
      wrB: usageFor({ team: 'DET', targetShare: 0.21 }),
    };
    const roles = buildTeamDepthRoles(players, usage);
    expect(roles.get('wrA')!.slot).toBe(1);
    expect(roles.get('wrB')!.slot).toBe(2);
    const again = buildTeamDepthRoles([...players].reverse(), usage);
    expect(again.get('wrA')!.slot).toBe(1);
    expect(again.get('wrB')!.slot).toBe(2);
    expect(again.get('wrB')!.room).toEqual(roles.get('wrB')!.room);
  });

  it('resolves a team: null player with a stale depthChartOrder to UNKNOWN_DEPTH_ROLE', () => {
    const roles = buildTeamDepthRoles(
      [player({ playerId: 'fa', team: null, depthChartOrder: 1 })],
      {},
    );
    expect(roles.get('fa')!.label).toBeNull();
    expect(roles.get('fa')).toEqual({ ...UNKNOWN_DEPTH_ROLE, playerId: 'fa' });
  });

  it('throws nothing on an empty usage artifact and never guesses a label without a signal', () => {
    expect(() => buildTeamDepthRoles([player({})], {})).not.toThrow();
    const roles = buildTeamDepthRoles([player({})], {});
    // No usage, no depth chart -> basis 'unknown' -> the card face renders an em dash, never a guess.
    expect(roles.get('p')!.label).toBeNull();
    expect(roles.get('p')!.basis).toBe('unknown');
    expect(roles.get('p')!.shape).toBe('unassessable');
  });

  it('demotes a measured slot-3 RB below the volume floor to Depth regardless of slot', () => {
    const roles = buildTeamDepthRoles(
      [
        player({ playerId: 'a', name: 'A', depthChartOrder: 1 }),
        player({ playerId: 'b', name: 'B', depthChartOrder: 2 }),
        player({ playerId: 'c', name: 'C', depthChartOrder: 3 }),
      ],
      {
        a: usageFor({ carryShare: 0.5 }),
        b: usageFor({ carryShare: 0.3 }),
        c: usageFor({ carryShare: 0.04 }),
      },
    );
    expect(roles.get('c')!.slot).toBe(3);
    expect(roles.get('c')!.label).toBe('Depth');
  });

  it('marks cross-team members without demoting them (recentTeam differs from room team)', () => {
    const roles = buildTeamDepthRoles(
      [player({ playerId: 'moved', name: 'Moved', team: 'DET', depthChartOrder: 1 })],
      {
        moved: usageFor({ team: 'KC', carryShare: 0.36 }),
      },
    );
    expect(roles.get('moved')!.basis).toBe('cross-team');
    expect(roles.get('moved')!.label).toBe('RB1');
    expect(roles.get('moved')!.room!.crossTeamTop).toBe(true);
    expect(roles.get('moved')!.provenance).toContain('measured at KC, not DET');
  });
});

// Real-data invariants — loaded from the committed data/ artifacts, no mocks (per CLAUDE.md's
// data-layer rule). The coverage-gate figure below is a file-doc pin in the spirit of
// recommendPerformance.test.ts: as of the 2026-08-13 committed snapshot, 199/200 of the top-200 PPR
// ADP skill players carry a label; the single miss is Tyreek Hill (team: null, correctly unknown).
// Re-pin whenever `npm run pipeline` legitimately refreshes committed data/.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
function loadRealData<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(dataDir, fileName), 'utf-8')) as T;
}

const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

describe('buildTeamDepthRoles against real committed data', () => {
  const players = loadRealData<PlayerMeta[]>('players.json');
  const usage = loadRealData<PlayerUsageArtifact>('player-usage.json');
  const roles = buildTeamDepthRoles(players, usage);

  it('is deterministic across two identical builds', () => {
    const again = buildTeamDepthRoles(players, usage);
    expect([...roles.entries()]).toEqual([...again.entries()]);
  });

  it('assigns exactly 1..N slots per room with no duplicates', () => {
    const rooms = new Map<string, TeamDepthRole[]>();
    for (const role of roles.values()) {
      if (role.room == null || role.slot == null) continue;
      const key = `${role.room.team}|${role.room.position}`;
      const list = rooms.get(key) ?? [];
      list.push(role);
      rooms.set(key, list);
    }
    expect(rooms.size).toBeGreaterThan(0);
    for (const list of rooms.values()) {
      const slots = list.map((role) => role.slot!).sort((a, b) => a - b);
      expect(slots).toEqual(Array.from({ length: slots.length }, (_, i) => i + 1));
    }
  });

  it('never has two players in a room share a non-Depth slot label (shape words are room-wide by design)', () => {
    // Slot labels (RB1..RB3, WR1..WR3, TE1..TE2, QB1..QB2) must be unique per room. The shape words
    // Split/Committee/Battle legitimately repeat across a room's members (B1's label contract), so
    // they are excluded here — their uniqueness is the room shape, checked separately.
    const rooms = new Map<string, TeamDepthRole[]>();
    for (const role of roles.values()) {
      if (role.room == null || role.label == null || role.label === 'Depth') continue;
      if (role.label === 'Split' || role.label === 'Committee' || role.label === 'Battle') continue;
      const key = `${role.room.team}|${role.room.position}`;
      const list = rooms.get(key) ?? [];
      list.push(role);
      rooms.set(key, list);
    }
    for (const list of rooms.values()) {
      const labels = list.map((role) => role.label!);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('keeps every label in its position-role allowed set', () => {
    const allowed: Readonly<Record<string, RegExp>> = {
      QB: /^(QB[1-2]|Depth|Battle)$/,
      RB: /^(RB[1-3]|Depth|Split|Committee)$/,
      WR: /^(WR[1-3]|Depth)$/,
      TE: /^(TE[1-2]|Depth)$/,
    };
    for (const role of roles.values()) {
      if (role.label == null) continue;
      const position = role.room?.position;
      const pattern = allowed[position ?? ''];
      expect(pattern).toBeDefined();
      expect(role.label).toMatch(pattern!);
    }
  });

  it('never claims split/committee/battle unless slots 1 and 2 are both measured (honesty guarantee)', () => {
    const ambiguous = new Set(['split', 'committee', 'battle']);
    for (const role of roles.values()) {
      if (role.room == null) continue;
      if (!ambiguous.has(role.room.shape)) continue;
      expect(role.room.members[0]?.share).not.toBeNull();
      expect(role.room.members[1]?.share).not.toBeNull();
    }
  });

  it('resolves every team: null player to UNKNOWN_DEPTH_ROLE', () => {
    const teamless = players.filter((player) => player.team == null);
    expect(teamless.length).toBeGreaterThan(0);
    for (const player of teamless) {
      expect(roles.get(player.playerId)).toEqual({ ...UNKNOWN_DEPTH_ROLE, playerId: player.playerId });
    }
  });

  it('keeps every member share finite and in [0,1]', () => {
    for (const role of roles.values()) {
      if (role.room == null) continue;
      for (const member of role.room.members) {
        if (member.share == null) continue;
        expect(Number.isFinite(member.share)).toBe(true);
        expect(member.share).toBeGreaterThanOrEqual(0);
        expect(member.share).toBeLessThanOrEqual(1);
      }
    }
  });

  it('labels at least 97% of the top-200 ADP PPR skill players (199/200 today)', () => {
    const adp = loadRealData<AdpEntry[]>('adp-ppr.json');
    const playersById = new Map(players.map((player) => [player.playerId, player]));
    const top200 = adp
      .filter((entry) => entry.playerId != null)
      .slice(0, 200);
    const skill = top200.filter((entry) => SKILL_POSITIONS.has(playersById.get(entry.playerId!)?.position ?? ''));
    // Top-200 ADP includes K/DEF rows, so the skill subset is smaller than 200 — sanity-floor the
    // sample size; the 97% ratio below is the actual coverage gate.
    expect(skill.length).toBeGreaterThanOrEqual(150);
    const labeled = skill.filter((entry) => roles.get(entry.playerId!)?.label != null);
    expect(labeled.length / skill.length).toBeGreaterThanOrEqual(0.97);
  });

  it('yields at least one committee, one split, and one battle on the real board (thresholds are not degenerate)', () => {
    const shapes = new Set<string>();
    for (const role of roles.values()) {
      if (role.room != null && role.slot === 1) shapes.add(role.room.shape);
    }
    expect(shapes.has('committee')).toBe(true);
    expect(shapes.has('split')).toBe(true);
    expect(shapes.has('battle')).toBe(true);
  });
});

describe('visibleDepthMembers', () => {
  const members = Array.from({ length: 12 }, (_, index) => ({ playerId: `p${index + 1}` }));

  it('returns the full list when it already fits', () => {
    expect(visibleDepthMembers(members.slice(0, 4), 'p2')).toEqual(members.slice(0, 4));
  });

  it('keeps the first five when the viewed player is in that window', () => {
    expect(visibleDepthMembers(members, 'p3').map((member) => member.playerId))
      .toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('windows around a deeper viewed player and still includes them', () => {
    expect(visibleDepthMembers(members, 'p8').map((member) => member.playerId))
      .toEqual(['p6', 'p7', 'p8', 'p9', 'p10']);
  });

  it('clamps the window to the end of the list', () => {
    expect(visibleDepthMembers(members, 'p12').map((member) => member.playerId))
      .toEqual(['p8', 'p9', 'p10', 'p11', 'p12']);
  });
});



