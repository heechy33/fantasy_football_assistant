import type {
  AdpEntry,
  DataManifest,
  PlayerMeta,
  PlayerUsageArtifact,
  SeasonProjection,
} from '../../../shared/types';

export interface ValidationIssue {
  check: string;
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(check: string, detail: string): ValidationIssue {
  return { check, detail };
}

/** Validate the committed completed-season PPR chart artifact without
 * requiring a series for every player or fabricating missing weeks. */
export function validateWeeklyScoring(artifact: unknown, draftSeason: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(artifact)) return [issue('weekly-artifact-object', 'artifact is not an object')];

  const schemaVersion = artifact.schemaVersion;
  if (!Number.isInteger(schemaVersion) || (schemaVersion as number) <= 0) {
    issues.push(issue('weekly-schema-version', 'schemaVersion is invalid: ' + String(schemaVersion)));
  }
  const season = artifact.season;
  if (!Number.isInteger(season) || (season as number) >= draftSeason) {
    issues.push(issue('weekly-season', 'season is invalid or not prior to ' + draftSeason + ': ' + String(season)));
  }

  const players = artifact.players;
  if (!isRecord(players)) {
    issues.push(issue('weekly-players-object', 'players is not an object'));
    return issues;
  }

  for (const [playerId, series] of Object.entries(players)) {
    if (!playerId.trim()) {
      issues.push(issue('weekly-player-id', 'player id is empty'));
    }
    if (!Array.isArray(series)) {
      issues.push(issue('weekly-series-array', playerId + ' series is not an array'));
      continue;
    }
    let previousWeek: number | null = null;
    const seenWeeks = new Set<number>();
    for (const [index, entry] of series.entries()) {
      if (!isRecord(entry)) {
        issues.push(issue('weekly-entry-object', playerId + '[' + index + '] is not an object'));
        continue;
      }
      const week = entry.week;
      if (!Number.isInteger(week) || (week as number) < 1 || (week as number) > 22) {
        issues.push(issue('weekly-week-range', playerId + '[' + index + '] has invalid week ' + String(week)));
      } else {
        if (seenWeeks.has(week as number)) {
          issues.push(issue('weekly-duplicate-week', playerId + ' repeats week ' + week));
        }
        if (previousWeek !== null && (week as number) <= previousWeek) {
          issues.push(issue('weekly-week-order', playerId + ' weeks are not strictly ascending'));
        }
        seenWeeks.add(week as number);
        previousWeek = week as number;
      }
      const points = entry.pointsPpr;
      if (typeof points !== 'number' || !Number.isFinite(points) || points < -30 || points > 90) {
        issues.push(issue('weekly-points-range', playerId + '[' + index + '] has invalid pointsPpr ' + String(points)));
      }
    }
  }
  return issues;
}

/**
 * Validate the committed weekly game-log artifact (`data/weekly-stats.json`).
 * Mirrors the pipeline's own row-shape invariants (see `pipeline/weekly_stats.py`)
 * so a schema drift between the two — e.g. a column inserted on one side but not
 * the other — fails loudly here instead of silently shifting every cell in the
 * rendered grid by one column.
 */
export function validateWeeklyStats(artifact: unknown, draftSeason: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(artifact)) return [issue('weekly-stats-artifact-object', 'artifact is not an object')];

  const schemaVersion = artifact.schemaVersion;
  if (!Number.isInteger(schemaVersion) || (schemaVersion as number) <= 0) {
    issues.push(issue('weekly-stats-schema-version', 'schemaVersion is invalid: ' + String(schemaVersion)));
  }
  const season = artifact.season;
  if (!Number.isInteger(season) || (season as number) >= draftSeason) {
    issues.push(issue('weekly-stats-season', 'season is invalid or not prior to ' + draftSeason + ': ' + String(season)));
  }

  const weeksFetchedRaw = artifact.weeksFetched;
  const weeksFetched = new Set<number>();
  if (!Array.isArray(weeksFetchedRaw)) {
    issues.push(issue('weekly-stats-weeks-fetched-array', 'weeksFetched is not an array'));
  } else {
    let previous: number | null = null;
    for (const week of weeksFetchedRaw) {
      if (!Number.isInteger(week) || week < 1 || week > 22) {
        issues.push(issue('weekly-stats-weeks-fetched-range', 'weeksFetched has an invalid week ' + String(week)));
        continue;
      }
      if (previous !== null && week <= previous) {
        issues.push(issue('weekly-stats-weeks-fetched-order', 'weeksFetched is not strictly ascending/unique at ' + week));
      }
      previous = week;
      weeksFetched.add(week);
    }
  }

  const columns = artifact.columns;
  const columnsByPosition = isRecord(columns) ? columns : null;
  if (!columnsByPosition) {
    issues.push(issue('weekly-stats-columns-object', 'columns is not an object'));
  } else {
    for (const [position, keys] of Object.entries(columnsByPosition)) {
      if (!Array.isArray(keys) || keys.length === 0 || !keys.every((key) => typeof key === 'string' && key.trim())) {
        issues.push(issue('weekly-stats-columns-position', position + ' columns is not a non-empty string array'));
      }
    }
  }

  const players = artifact.players;
  if (!isRecord(players)) {
    issues.push(issue('weekly-stats-players-object', 'players is not an object'));
    return issues;
  }

  for (const [playerId, seriesValue] of Object.entries(players)) {
    if (!playerId.trim()) {
      issues.push(issue('weekly-stats-player-id', 'player id is empty'));
    }
    if (!isRecord(seriesValue)) {
      issues.push(issue('weekly-stats-series-object', playerId + ' series is not an object'));
      continue;
    }
    const position = seriesValue.p;
    const positionColumns = columnsByPosition && typeof position === 'string' ? columnsByPosition[position] : undefined;
    if (typeof position !== 'string' || !Array.isArray(positionColumns)) {
      issues.push(issue('weekly-stats-series-position', playerId + ' position ' + String(position) + ' is not in columns'));
      continue;
    }
    const bye = seriesValue.bye;
    if (bye !== null && (!Number.isInteger(bye) || (bye as number) < 1 || (bye as number) > 22)) {
      issues.push(issue('weekly-stats-bye', playerId + ' has invalid bye ' + String(bye)));
    }

    const rows = seriesValue.w;
    if (!Array.isArray(rows)) {
      issues.push(issue('weekly-stats-rows-array', playerId + ' w is not an array'));
      continue;
    }
    const expectedLength = positionColumns.length + 1; // +1 for the leading week value
    let previousWeek: number | null = null;
    const ptsIndex = positionColumns.indexOf('pts') + 1;
    for (const [index, row] of rows.entries()) {
      if (!Array.isArray(row) || row.length !== expectedLength) {
        issues.push(issue(
          'weekly-stats-row-width',
          playerId + '[' + index + '] has length ' + String((row as unknown[])?.length) + ', expected ' + expectedLength,
        ));
        continue;
      }
      const week = row[0];
      if (!Number.isInteger(week) || week < 1 || week > 22) {
        issues.push(issue('weekly-stats-row-week-range', playerId + '[' + index + '] has invalid week ' + String(week)));
      } else {
        if (previousWeek !== null && week <= previousWeek) {
          issues.push(issue('weekly-stats-row-week-order', playerId + ' weeks are not strictly ascending at ' + week));
        }
        if (weeksFetchedRaw != null && !weeksFetched.has(week)) {
          issues.push(issue('weekly-stats-row-week-not-fetched', playerId + ' has a row for week ' + week + ' that is not in weeksFetched'));
        }
        previousWeek = week;
      }
      if (ptsIndex > 0) {
        const points = row[ptsIndex];
        if (typeof points !== 'number' || !Number.isFinite(points) || points < -30 || points > 90) {
          issues.push(issue('weekly-stats-row-pts-range', playerId + '[' + index + '] has invalid pts ' + String(points)));
        }
      }
    }
  }

  const heat = artifact.heat;
  if (heat !== undefined) {
    if (!isRecord(heat)) {
      issues.push(issue('weekly-stats-heat-object', 'heat is not an object'));
    } else {
      for (const [position, byColumn] of Object.entries(heat)) {
        if (!isRecord(byColumn)) {
          issues.push(issue('weekly-stats-heat-position', position + ' heat entry is not an object'));
          continue;
        }
        for (const [column, breakpoints] of Object.entries(byColumn)) {
          if (breakpoints === null) continue;
          const valid = Array.isArray(breakpoints)
            && breakpoints.length === 4
            && breakpoints.every((value) => typeof value === 'number' && Number.isFinite(value))
            && breakpoints.every((value, index) => index === 0 || value >= (breakpoints[index - 1] as number));
          if (!valid) {
            issues.push(issue(
              'weekly-stats-heat-breakpoints',
              position + '.' + column + ' breakpoints must be null or 4 finite non-decreasing numbers',
            ));
          }
        }
      }
    }
  }

  return issues;
}

/** Validate the optional local-only FantasyPros decoration if it is present. */
export function validateFantasyProsStars(artifact: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(artifact)) return [issue('fantasypros-artifact-object', 'artifact is not an object')];

  if (!Number.isInteger(artifact.schemaVersion) || (artifact.schemaVersion as number) <= 0) {
    issues.push(issue('fantasypros-schema-version', 'schemaVersion is invalid: ' + String(artifact.schemaVersion)));
  }
  if (!Number.isInteger(artifact.season)) {
    issues.push(issue('fantasypros-season', 'season is invalid: ' + String(artifact.season)));
  }

  const source = artifact.source;
  const sourceRecord = isRecord(source) ? source : null;
  if (!sourceRecord) {
    issues.push(issue('fantasypros-source-object', 'source is not an object'));
  }
  const players = artifact.players;
  const playerRecord = isRecord(players) ? players : null;
  if (!playerRecord) {
    issues.push(issue('fantasypros-players-object', 'players is not an object'));
  }
  const unmatched = artifact.unmatched;
  if (!Array.isArray(unmatched)) {
    issues.push(issue('fantasypros-unmatched-array', 'unmatched is not an array'));
  }

  if (sourceRecord) {
    for (const field of ['rows', 'droppedNonRankRows', 'matched', 'unmatched'] as const) {
      const value = sourceRecord[field];
      if (!Number.isInteger(value) || (value as number) < 0) {
        issues.push(issue('fantasypros-source-count', 'source.' + field + ' is invalid: ' + String(value)));
      }
    }
    if (sourceRecord.status !== 'ok') {
      issues.push(issue('fantasypros-source-status', 'source.status is not ok: ' + String(sourceRecord.status)));
    }
    if (playerRecord && sourceRecord.matched !== Object.keys(playerRecord).length) {
      issues.push(issue('fantasypros-matched-count', 'source.matched does not equal players count'));
    }
    if (
      typeof sourceRecord.matched === 'number'
      && typeof sourceRecord.unmatched === 'number'
      && typeof sourceRecord.rows === 'number'
      && sourceRecord.matched + sourceRecord.unmatched !== sourceRecord.rows
    ) {
      issues.push(issue('fantasypros-source-reconciliation', 'source.matched + source.unmatched does not equal source.rows'));
    }
    if (Array.isArray(unmatched) && typeof sourceRecord.unmatched === 'number' && sourceRecord.unmatched !== unmatched.length) {
      issues.push(issue('fantasypros-unmatched-count', 'source.unmatched does not equal unmatched length'));
    }
  }

  if (playerRecord) {
    for (const [playerId, value] of Object.entries(playerRecord)) {
      if (!isRecord(value)) {
        issues.push(issue('fantasypros-player-value', playerId + ' is not an object'));
        continue;
      }
      if (!Number.isInteger(value.rank) || (value.rank as number) <= 0) {
        issues.push(issue('fantasypros-player-rank', playerId + ' has invalid rank ' + String(value.rank)));
      }
      if (value.tier !== null && (!Number.isInteger(value.tier) || (value.tier as number) <= 0)) {
        issues.push(issue('fantasypros-player-tier', playerId + ' has invalid tier ' + String(value.tier)));
      }
      if (typeof value.positionRank !== 'string' || !value.positionRank.trim()) {
        issues.push(issue('fantasypros-player-position-rank', playerId + ' has invalid positionRank'));
      }
      for (const field of ['upside', 'bust'] as const) {
        const stars = value[field];
        if (stars !== null && (!Number.isInteger(stars) || (stars as number) < 1 || (stars as number) > 5)) {
          issues.push(issue('fantasypros-' + field + '-range', playerId + ' has invalid ' + field + ' ' + String(stars)));
        }
      }
      const sos = value.sos;
      if (sos !== null && (!Number.isInteger(sos) || (sos as number) < 0 || (sos as number) > 5)) {
        issues.push(issue('fantasypros-sos-range', playerId + ' has invalid sos ' + String(sos)));
      }
      if (value.ecrVsAdp !== null && !Number.isInteger(value.ecrVsAdp)) {
        issues.push(issue('fantasypros-ecr-integer', playerId + ' has invalid ecrVsAdp ' + String(value.ecrVsAdp)));
      }
    }
  }

  if (Array.isArray(unmatched)) {
    for (const [index, value] of unmatched.entries()) {
      if (!isRecord(value)) {
        issues.push(issue('fantasypros-unmatched-row', 'unmatched[' + index + '] is not an object'));
        continue;
      }
      if (!Number.isInteger(value.rank) || (value.rank as number) <= 0) {
        issues.push(issue('fantasypros-unmatched-rank', 'unmatched[' + index + '] has invalid rank'));
      }
      if (typeof value.name !== 'string' || !value.name.trim()) {
        issues.push(issue('fantasypros-unmatched-name', 'unmatched[' + index + '] has invalid name'));
      }
      if (value.team !== null && typeof value.team !== 'string') {
        issues.push(issue('fantasypros-unmatched-team', 'unmatched[' + index + '] has invalid team'));
      }
      if (typeof value.position !== 'string' || !value.position.trim()) {
        issues.push(issue('fantasypros-unmatched-position', 'unmatched[' + index + '] has invalid position'));
      }
    }
  }
  return issues;
}

/** Validate the optional local-only FantasyPros per-site ADP decoration if present. */
export function validateFantasyProsAdp(artifact: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(artifact)) return [issue('fantasypros-adp-object', 'artifact is not an object')];

  if (!Number.isInteger(artifact.schemaVersion) || (artifact.schemaVersion as number) <= 0) {
    issues.push(issue('fantasypros-adp-schema-version', 'schemaVersion is invalid: ' + String(artifact.schemaVersion)));
  }
  if (!Number.isInteger(artifact.season)) {
    issues.push(issue('fantasypros-adp-season', 'season is invalid: ' + String(artifact.season)));
  }

  const source = artifact.source;
  const sourceRecord = isRecord(source) ? source : null;
  if (!sourceRecord) {
    issues.push(issue('fantasypros-adp-source-object', 'source is not an object'));
  }
  const players = artifact.players;
  const playerRecord = isRecord(players) ? players : null;
  if (!playerRecord) {
    issues.push(issue('fantasypros-adp-players-object', 'players is not an object'));
  }
  const unmatched = artifact.unmatched;
  if (!Array.isArray(unmatched)) {
    issues.push(issue('fantasypros-adp-unmatched-array', 'unmatched is not an array'));
  }
  const providers = artifact.providers;
  if (!Array.isArray(providers)) {
    issues.push(issue('fantasypros-adp-providers-array', 'providers is not an array'));
  }

  if (sourceRecord) {
    for (const field of ['rows', 'matched', 'unmatched'] as const) {
      const value = sourceRecord[field];
      if (!Number.isInteger(value) || (value as number) < 0) {
        issues.push(issue('fantasypros-adp-source-count', 'source.' + field + ' is invalid: ' + String(value)));
      }
    }
    if (!Array.isArray(sourceRecord.emptyColumns)) {
      issues.push(issue('fantasypros-adp-empty-columns', 'source.emptyColumns is not an array'));
    }
    if (sourceRecord.status !== 'ok') {
      issues.push(issue('fantasypros-adp-source-status', 'source.status is not ok: ' + String(sourceRecord.status)));
    }
    if (
      typeof sourceRecord.matched === 'number'
      && typeof sourceRecord.unmatched === 'number'
      && typeof sourceRecord.rows === 'number'
      && sourceRecord.matched + sourceRecord.unmatched !== sourceRecord.rows
    ) {
      issues.push(issue('fantasypros-adp-source-reconciliation', 'source.matched + source.unmatched does not equal source.rows'));
    }
    if (playerRecord && sourceRecord.matched !== Object.keys(playerRecord).length) {
      issues.push(issue('fantasypros-adp-matched-count', 'source.matched does not equal players count'));
    }
    if (Array.isArray(unmatched) && typeof sourceRecord.unmatched === 'number' && sourceRecord.unmatched !== unmatched.length) {
      issues.push(issue('fantasypros-adp-unmatched-count', 'source.unmatched does not equal unmatched length'));
    }
  }

  if (Array.isArray(providers)) {
    const providerKeys = new Set<string>();
    for (const [index, value] of providers.entries()) {
      if (!isRecord(value) || typeof value.key !== 'string' || typeof value.label !== 'string') {
        issues.push(issue('fantasypros-adp-provider-shape', 'providers[' + index + '] is malformed'));
        continue;
      }
      if (providerKeys.has(value.key)) {
        issues.push(issue('fantasypros-adp-provider-duplicate', 'duplicate provider key ' + value.key));
      }
      providerKeys.add(value.key);
      for (const field of ['rows', 'matchedRows'] as const) {
        const count = value[field];
        if (!Number.isInteger(count) || (count as number) < 0) {
          issues.push(issue('fantasypros-adp-provider-count', 'providers[' + index + '] ' + field + ' is invalid'));
        }
      }
    }
  }

  if (playerRecord) {
    for (const [playerId, value] of Object.entries(playerRecord)) {
      if (!isRecord(value)) {
        issues.push(issue('fantasypros-adp-player-value', playerId + ' is not an object'));
        continue;
      }
      if (!Number.isInteger(value.rank) || (value.rank as number) <= 0) {
        issues.push(issue('fantasypros-adp-player-rank', playerId + ' has invalid rank ' + String(value.rank)));
      }
      if (typeof value.positionRank !== 'string' || !value.positionRank.trim()) {
        issues.push(issue('fantasypros-adp-player-position-rank', playerId + ' has invalid positionRank'));
      }
      const adp = value.adp;
      if (adp !== undefined) {
        if (!isRecord(adp)) {
          issues.push(issue('fantasypros-adp-player-adp-object', playerId + ' adp is not an object'));
        } else {
          for (const [key, adpValue] of Object.entries(adp)) {
            if (typeof adpValue !== 'number' || !Number.isFinite(adpValue) || adpValue < 0) {
              issues.push(issue('fantasypros-adp-player-adp-value', playerId + ' adp.' + key + ' is invalid'));
            }
          }
        }
      }
      const avg = value.avg;
      if (avg !== undefined && (typeof avg !== 'number' || !Number.isFinite(avg) || avg < 0)) {
        issues.push(issue('fantasypros-adp-player-avg', playerId + ' has invalid avg'));
      }
      const realTime = value.realTime;
      if (realTime !== undefined) {
        if (
          !isRecord(realTime)
          || typeof realTime.rank !== 'number' || !Number.isInteger(realTime.rank)
          || (realTime.delta !== null && typeof realTime.delta !== 'number')
        ) {
          issues.push(issue('fantasypros-adp-player-real-time', playerId + ' has invalid realTime'));
        }
      }
    }
  }

  if (Array.isArray(unmatched)) {
    for (const [index, value] of unmatched.entries()) {
      if (!isRecord(value)) {
        issues.push(issue('fantasypros-adp-unmatched-row', 'unmatched[' + index + '] is not an object'));
        continue;
      }
      if (!Number.isInteger(value.rank) || (value.rank as number) <= 0) {
        issues.push(issue('fantasypros-adp-unmatched-rank', 'unmatched[' + index + '] has invalid rank'));
      }
      if (typeof value.name !== 'string' || !value.name.trim()) {
        issues.push(issue('fantasypros-adp-unmatched-name', 'unmatched[' + index + '] has invalid name'));
      }
      if (typeof value.reason !== 'string' || !value.reason.trim()) {
        issues.push(issue('fantasypros-adp-unmatched-reason', 'unmatched[' + index + '] has invalid reason'));
      }
    }
  }
  return issues;
}


/** Validate the committed multi-provider projections artifact (display-only). */
export function validateProviderProjections(artifact: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(artifact)) return [issue('provider-projections-object', 'artifact is not an object')];

  if (artifact.displayOnly !== true) {
    issues.push(issue('provider-projections-display-only', 'displayOnly must be true'));
  }
  if (!Number.isInteger(artifact.schemaVersion) || (artifact.schemaVersion as number) <= 0) {
    issues.push(issue('provider-projections-schema-version', 'schemaVersion is invalid: ' + String(artifact.schemaVersion)));
  }
  if (!Number.isInteger(artifact.season)) {
    issues.push(issue('provider-projections-season', 'season is invalid: ' + String(artifact.season)));
  }

  const providers = artifact.providers;
  if (!Array.isArray(providers)) {
    issues.push(issue('provider-projections-providers-array', 'providers is not an array'));
  } else {
    for (const [index, provider] of providers.entries()) {
      if (
        !isRecord(provider)
        || typeof provider.key !== 'string' || !provider.key.trim()
        || typeof provider.label !== 'string'
        || !['ok', 'stale', 'error'].includes(provider.status as string)
        || !Number.isInteger(provider.rows) || (provider.rows as number) < 0
      ) {
        issues.push(issue('provider-projections-provider-shape', 'providers[' + index + '] is malformed'));
        continue;
      }
      if (provider.staleSinceDays !== null && typeof provider.staleSinceDays !== 'number') {
        issues.push(issue('provider-projections-provider-stale', 'providers[' + index + '] staleSinceDays is invalid'));
      }
      if (provider.diagnostic !== null && typeof provider.diagnostic !== 'string') {
        issues.push(issue('provider-projections-provider-diagnostic', 'providers[' + index + '] diagnostic is invalid'));
      }
    }
  }

  const players = artifact.players;
  if (!isRecord(players)) {
    issues.push(issue('provider-projections-players-object', 'players is not an object'));
    return issues;
  }
  for (const [playerId, providerMap] of Object.entries(players)) {
    if (!playerId.trim()) {
      issues.push(issue('provider-projections-player-id', 'empty playerId'));
      continue;
    }
    if (!isRecord(providerMap)) {
      issues.push(issue('provider-projections-player-map', playerId + ' provider map is not an object'));
      continue;
    }
    for (const [providerKey, stats] of Object.entries(providerMap)) {
      if (!providerKey.trim() || !isRecord(stats)) {
        issues.push(issue('provider-projections-player-stats', playerId + ' ' + providerKey + ' stats are not an object'));
        continue;
      }
      for (const [statKey, value] of Object.entries(stats)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          issues.push(issue('provider-projections-stat-value', playerId + ' ' + providerKey + '.' + statKey + ' is invalid'));
        }
      }
    }
  }
  return issues;
}

export function validateUniquePlayerIds(players: PlayerMeta[]): ValidationIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const player of players) {
    if (seen.has(player.playerId)) duplicates.add(player.playerId);
    seen.add(player.playerId);
  }
  return [...duplicates].map((id) => ({
    check: 'unique-player-id',
    detail: `duplicate playerId ${id}`,
  }));
}

export function validateFiniteProjections(projections: SeasonProjection[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const projection of projections) {
    for (const [stat, value] of Object.entries(projection.stats)) {
      if (!Number.isFinite(value)) {
        issues.push({
          check: 'finite-projection-stat',
          detail: `${projection.playerId} stat ${stat} is not finite (${value})`,
        });
      }
    }
  }
  return issues;
}

export function validateAdpRanges(entries: AdpEntry[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const entry of entries) {
    if (!Number.isFinite(entry.adp) || entry.adp < 0) {
      issues.push({ check: 'adp-non-negative', detail: `${entry.name} has invalid adp ${entry.adp}` });
    }
    if (!Number.isFinite(entry.stdev) || entry.stdev < 0) {
      issues.push({
        check: 'adp-stdev-non-negative',
        detail: `${entry.name} has invalid stdev ${entry.stdev}`,
      });
    }
  }
  return issues;
}

/** `high`/`low`/`timesDrafted` are `null`, not a real 0, when a source (Sleeper's lobby ADP, or ESPN's leaguedefaults feed) doesn't
 * expose them at all — see AdpEntry's doc. Checks the provenance tags are one of the declared
 * values and that each source's nullability contract holds: FFC always carries observed population
 * fields; Sleeper and ESPN always carry fitted stdev with null population fields. */
export function validateAdpProvenance(entries: AdpEntry[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const entry of entries) {
    if (entry.adpSource !== 'sleeper' && entry.adpSource !== 'ffc' && entry.adpSource !== 'espn') {
      issues.push({ check: 'adp-source-valid', detail: `${entry.name} has invalid adpSource ${String(entry.adpSource)}` });
    }
    if (entry.stdevSource !== 'observed' && entry.stdevSource !== 'fitted') {
      issues.push({ check: 'adp-stdev-source-valid', detail: `${entry.name} has invalid stdevSource ${String(entry.stdevSource)}` });
    }
    for (const [field, value] of [['high', entry.high], ['low', entry.low], ['timesDrafted', entry.timesDrafted]] as const) {
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        issues.push({ check: 'adp-population-field-non-negative', detail: `${entry.name} has invalid ${field} ${value}` });
      }
    }
    if (entry.adpSource === 'ffc') {
      if (entry.high == null || entry.low == null || entry.timesDrafted == null) {
        issues.push({
          check: 'adp-ffc-population-present',
          detail: `${entry.name} is adpSource 'ffc' but is missing high/low/timesDrafted`,
        });
      }
      if (entry.stdevSource !== 'observed') {
        issues.push({
          check: 'adp-ffc-stdev-observed',
          detail: `${entry.name} is adpSource 'ffc' but stdevSource is ${entry.stdevSource}`,
        });
      }
    }
    if (entry.adpSource === 'sleeper' || entry.adpSource === 'espn') {
      if (entry.stdevSource !== 'fitted') {
        issues.push({
          check: entry.adpSource === 'espn' ? 'adp-espn-stdev-fitted' : 'adp-sleeper-stdev-fitted',
          detail: `${entry.name} is adpSource '${entry.adpSource}' but stdevSource is ${entry.stdevSource}`,
        });
      }
      if (entry.high != null || entry.low != null || entry.timesDrafted != null) {
        issues.push({
          check: entry.adpSource === 'espn' ? 'adp-espn-population-absent' : 'adp-sleeper-population-absent',
          detail: `${entry.name} is adpSource '${entry.adpSource}' but has high/low/timesDrafted set`,
        });
      }
    }
  }
  return issues;
}

export function validateManifestCrosswalk(manifest: DataManifest): ValidationIssue[] {
  const rate = manifest.crosswalk?.top300MatchRate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    return [
      {
        check: 'manifest-crosswalk-rate',
        detail: `top300MatchRate missing or out of [0,1]: ${rate}`,
      },
    ];
  }
  return [];
}


export function validatePlayerUsage(usage: PlayerUsageArtifact, draftSeason: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rateFields = ['snapPct', 'targetShare', 'carryShare', 'availabilityRate'] as const;
  for (const [playerId, player] of Object.entries(usage)) {
    if (typeof player.usageSeasonObserved !== 'boolean') {
      issues.push({ check: 'context-usage-season-flag', detail: `${playerId} missing usageSeasonObserved` });
    }
    for (const field of rateFields) {
      const value = player[field];
      if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) {
        issues.push({ check: 'context-rate', detail: `${playerId} ${field} is outside [0,1]: ${value}` });
      }
    }
    if (player.season >= draftSeason) {
      issues.push({ check: 'context-season-cutoff', detail: `${playerId} usage season ${player.season} is not prior to ${draftSeason}` });
    }
    if (!player.usageSeasonObserved) {
      if (player.knownAbsent || player.gamesWithAnySnap > 0 || player.snapPct != null || player.targetShare != null || player.carryShare != null) {
        issues.push({
          check: 'context-usage-season-empty',
          detail: `${playerId} has usage metrics without usage-season evidence`,
        });
      }
      if (player.opportunity != null) {
        issues.push({ check: 'context-usage-season-empty', detail: playerId + ' has derived context without usage-season evidence' });
      }
      if (player.production != null) {
        issues.push({ check: 'context-usage-season-empty', detail: playerId + ' has production without usage-season evidence' });
      }
    }
    if (player.durabilityScore != null) {
      const score = player.durabilityScore;
      if (!Number.isFinite(score.score) || score.score < 0 || score.score > 100) {
        issues.push({ check: 'context-durability-score', detail: playerId + ' score is outside [0,100]' });
      }
      const expectedScore = Object.values(score.components).reduce((sum, value) => sum + value, 0);
      if (Math.abs(expectedScore - score.score) > 1.01) {
        issues.push({ check: 'context-durability-components', detail: playerId + ' score does not equal its components' });
      }
    }
    if (player.opportunity != null) {
      const periods = [player.opportunity.season, player.opportunity.finalFive].filter((value): value is NonNullable<typeof value> => value != null);
      for (const period of periods) {
        for (const field of ['targetShare', 'carryShare', 'airYardsShare', 'snapPct'] as const) {
          const value = period[field];
          if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) {
            issues.push({ check: 'context-opportunity-rate', detail: playerId + ' ' + field + ' is outside [0,1]' });
          }
        }
        if (period.games <= 0 || period.games > 34 || period.targets < 0 || period.carries < 0) {
          issues.push({ check: 'context-opportunity-denominator', detail: playerId + ' has invalid opportunity totals' });
        }
      }
      if (player.opportunity.finalFive && player.opportunity.finalFive.games > player.opportunity.season.games) {
        issues.push({ check: 'context-opportunity-final-five', detail: playerId + ' final-five games exceed season games' });
      }
      for (const value of Object.values(player.opportunity.roleEvolution)) {
        if (value != null && !Number.isFinite(value)) {
          issues.push({ check: 'context-opportunity-delta', detail: playerId + ' has a non-finite role delta' });
        }
      }
    }
    if (player.production != null) {
      const production = player.production;
      if (!Number.isInteger(production.games) || production.games <= 0 || production.games > 34) {
        issues.push({ check: 'context-production-games', detail: playerId + ' has invalid production games' });
      }
      if (!Number.isFinite(production.pointsPpr)) {
        issues.push({ check: 'context-production-points', detail: playerId + ' has a non-finite pointsPpr' });
      }
      // Receptions/TDs are true counts and can never be negative. Yardage is
      // real net yardage, not a count -- a season can finish with negative
      // net rushing/receiving yards (e.g. a WR's only carries were end-arounds
      // that lost yardage, or a RB's rare targets were all thrown behind the
      // line). Verified against the committed artifact: 25 real players carry
      // a negative rushingYards or receivingYards alongside an otherwise
      // normal season. Only non-finite is actually invalid for those two.
      const nonNegativeFields = ['receptions', 'receivingTds', 'rushingTds'] as const;
      for (const field of nonNegativeFields) {
        const value = production[field];
        if (!Number.isFinite(value) || value < 0) {
          issues.push({ check: 'context-production-count', detail: playerId + ' ' + field + ' is invalid' });
        }
      }
      for (const field of ['receivingYards', 'rushingYards'] as const) {
        const value = production[field];
        if (!Number.isFinite(value)) {
          issues.push({ check: 'context-production-count', detail: playerId + ' ' + field + ' is invalid' });
        }
      }
      if (production.pointsPprPerGame != null) {
        if (!Number.isFinite(production.pointsPprPerGame)) {
          issues.push({ check: 'context-production-ppg', detail: playerId + ' has a non-finite pointsPprPerGame' });
        } else if (production.games > 0 && Math.abs(production.pointsPprPerGame - production.pointsPpr / production.games) > 1e-6) {
          issues.push({ check: 'context-production-ppg', detail: playerId + ' pointsPprPerGame does not match pointsPpr / games' });
        }
      }
    }
    const ordered = [...player.seasons].sort((a, b) => a.season - b.season);
    if (player.seasons.some((value, index) => value.season !== ordered[index]?.season)) {
      issues.push({ check: 'context-season-order', detail: `${playerId} seasons are not ascending` });
    }
    let possible = 0;
    let appeared = 0;
    for (const season of player.seasons) {
      possible += season.teamGamesWhileRostered;
      appeared += season.gamesWithAnySnap;
      if (season.season >= draftSeason) {
        issues.push({ check: 'context-season-cutoff', detail: `${playerId} contains season ${season.season}` });
      }
      if (season.teamGamesWhileRostered <= 0 || season.gamesWithAnySnap < 0 || season.gamesWithAnySnap > season.teamGamesWhileRostered) {
        issues.push({ check: 'context-denominator', detail: `${playerId} has invalid ${season.season} game totals` });
      }
      const expected = season.gamesWithAnySnap / season.teamGamesWhileRostered;
      if (Math.abs(season.availabilityRate - expected) > 1e-9) {
        issues.push({ check: 'context-season-rate', detail: `${playerId} has inconsistent ${season.season} availability` });
      }
    }
    const expectedRollup = possible > 0 ? appeared / possible : null;
    if (
      (expectedRollup == null) !== (player.availabilityRate == null)
      || (expectedRollup != null && player.availabilityRate != null && Math.abs(expectedRollup - player.availabilityRate) > 1e-9)
    ) {
      issues.push({ check: 'context-rollup-rate', detail: `${playerId} pooled availability is inconsistent` });
    }
  }
  return issues;
}
