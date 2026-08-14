/**
 * Runtime display metadata for `data/weekly-stats.json` columns: header text,
 * group (for the grid's two-row header), number format, and polarity. This is
 * the frontend's own copy of column *presentation* — the artifact's
 * `columns[position]` array is the source of truth for column *order and
 * membership*; this module is looked up by key, never by array position, so a
 * pipeline column insertion degrades to a missing column instead of a
 * silently shifted grid. See `shared/types.d.ts`'s `WeeklyStatRow` doc and
 * CLAUDE.md's ".d.ts stays type-only" rule — runtime constants like this
 * table live on the frontend side, not in the shared types file.
 */

export type WeeklyStatFormat = 'int' | 'dec1' | 'pct' | 'text';
export type WeeklyStatGroup = 'core' | 'passing' | 'rushing' | 'receiving' | 'kicking' | 'defense';
export type WeeklyStatPolarity = 'higher-better' | 'lower-better';

export interface WeeklyStatColumnSpec {
  key: string;
  header: string;
  group: WeeklyStatGroup;
  format: WeeklyStatFormat;
  polarity: WeeklyStatPolarity;
  /** false only for `opp` and `fin` -- a rank is already a percentile, and shading it invites misreading. */
  shade: boolean;
}

export const WEEKLY_STAT_GROUP_LABEL: Readonly<Record<WeeklyStatGroup, string>> = {
  core: 'Fantasy',
  passing: 'Passing',
  rushing: 'Rushing',
  receiving: 'Receiving',
  kicking: 'Kicking',
  defense: 'Defense',
};

function spec(
  key: string,
  header: string,
  group: WeeklyStatGroup,
  format: WeeklyStatFormat = 'int',
  polarity: WeeklyStatPolarity = 'higher-better',
): WeeklyStatColumnSpec {
  return { key, header, group, format, polarity, shade: key !== 'opp' && key !== 'fin' };
}

const CORE: WeeklyStatColumnSpec[] = [
  spec('pts', 'FPTS', 'core', 'dec1'),
  spec('opp', 'OPP', 'core', 'text'),
  spec('snp', 'SNP%', 'core', 'int'),
  spec('fin', 'FIN', 'core', 'text'),
];

const PASSING: WeeklyStatColumnSpec[] = [
  spec('pass_cmp', 'CMP', 'passing'),
  spec('pass_att', 'ATT', 'passing'),
  spec('cmp_pct', 'CMP%', 'passing', 'dec1'),
  spec('pass_yd', 'YDS', 'passing'),
  spec('pass_ypa', 'Y/A', 'passing', 'dec1'),
  spec('pass_td', 'TD', 'passing'),
  spec('pass_int', 'INT', 'passing', 'int', 'lower-better'),
  spec('pass_air_yd', 'AIR', 'passing'),
  spec('pass_sack', 'SACK', 'passing', 'int', 'lower-better'),
  spec('pass_rtg', 'RTG', 'passing', 'dec1'),
];

const RUSHING: WeeklyStatColumnSpec[] = [
  spec('rush_att', 'ATT', 'rushing'),
  spec('rush_yd', 'YDS', 'rushing'),
  spec('rush_ypa', 'Y/A', 'rushing', 'dec1'),
  spec('rush_td', 'TD', 'rushing'),
];

// RB gets {rec_tgt,rec,rec_yd,rec_td,fum_lost} (no rec_ypr/rec_air_yd); WR/TE
// get {rec_tgt,rec,rec_yd,rec_ypr,rec_air_yd,rec_td} (no fum_lost) -- mirrors
// pipeline/weekly_stats.py's POSITION_COLUMNS exactly, not a superset per position.
const REC_CORE: WeeklyStatColumnSpec[] = [
  spec('rec_tgt', 'TGT', 'receiving'),
  spec('rec', 'REC', 'receiving'),
  spec('rec_yd', 'YDS', 'receiving'),
];
const REC_TD = spec('rec_td', 'TD', 'receiving');
const REC_YPR = spec('rec_ypr', 'Y/R', 'receiving', 'dec1');
const REC_AIR = spec('rec_air_yd', 'AIR', 'receiving');
const REC_FUM_LOST = spec('fum_lost', 'FUM', 'receiving', 'int', 'lower-better');

const KICKING: WeeklyStatColumnSpec[] = [
  spec('fgm', 'FGM', 'kicking'),
  spec('fga', 'FGA', 'kicking'),
  spec('fgm_pct', 'FG%', 'kicking', 'dec1'),
  spec('fgm_lng', 'LNG', 'kicking'),
  spec('fgm_50p', '50+', 'kicking'),
  spec('fgm_yds', 'FG YD', 'kicking'),
  spec('xpm', 'XPM', 'kicking'),
  spec('xpa', 'XPA', 'kicking'),
];

const DEFENSE: WeeklyStatColumnSpec[] = [
  spec('sack', 'SACK', 'defense'),
  spec('int', 'INT', 'defense'),
  spec('fum_rec', 'FR', 'defense'),
  spec('ff', 'FF', 'defense'),
  spec('def_td', 'DEF TD', 'defense'),
  spec('blk_kick', 'BLK', 'defense'),
  spec('safe', 'SFTY', 'defense'),
  spec('qb_hit', 'QBH', 'defense'),
  spec('def_pass_def', 'PD', 'defense'),
  spec('pts_allow', 'PA', 'defense', 'int', 'lower-better'),
  spec('yds_allow', 'YA', 'defense', 'int', 'lower-better'),
];

const RUSH_NO_YPA = RUSHING.filter((c) => c.key !== 'rush_ypa'); // QB/WR: att, yd, td only

/** Keyed by position, matching `PlayerWeeklyStatsArtifact.columns` positions'
 * exact key SET (see pipeline/weekly_stats.py's POSITION_COLUMNS). Every
 * entry here is looked up by `key`, so extra/missing columns degrade
 * gracefully rather than misaligning the grid. */
export const WEEKLY_STAT_COLUMNS: Readonly<Record<string, WeeklyStatColumnSpec[]>> = {
  QB: [...CORE, ...PASSING, ...RUSH_NO_YPA],
  RB: [...CORE, ...RUSHING, ...REC_CORE, REC_TD, REC_FUM_LOST],
  WR: [...CORE, ...REC_CORE, REC_YPR, REC_AIR, REC_TD, ...RUSH_NO_YPA],
  TE: [...CORE, ...REC_CORE, REC_YPR, REC_AIR, REC_TD],
  K: [...CORE, ...KICKING],
  DEF: [
    spec('pts', 'FPTS', 'core', 'dec1'),
    spec('opp', 'OPP', 'core', 'text'),
    spec('fin', 'FIN', 'core', 'text'),
    ...DEFENSE,
  ],
};

const SPEC_BY_KEY: Readonly<Record<string, WeeklyStatColumnSpec>> = Object.fromEntries(
  Object.values(WEEKLY_STAT_COLUMNS).flat().map((column) => [column.key, column]),
);

/** Look up display metadata for a column key regardless of position -- every
 * position's spec for a shared key (e.g. `rush_td`) is identical. */
export function weeklyStatColumnSpec(key: string): WeeklyStatColumnSpec | undefined {
  return SPEC_BY_KEY[key];
}
