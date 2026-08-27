import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Position } from '../../../shared/types';
import { resolvePlayerContextFeedStatus } from '../data/playerContext';
import {
  parseGuideFormat,
  serializeGuideFormat,
  guideAdpFormat,
  GUIDE_POSITIONS,
} from '../data/guideLeagueSettings';
import { buildProviderColumn, unavailableProviderColumn, LANE_NOTES, type GuideRankSource, type ProviderColumn } from '../data/guideProviderColumns';
import { buildLaneCell, buildPositionRankByPlayer, formatRelativeAge, serializeGuideCsv, type GuideLane } from '../data/guideTableColumns';
import { buildTeamDepthRoles } from '../data/teamDepthRole';
import { sortGuideRows, type GuideRow } from '../data/guideBoard';
import { useDraftGuideBoard } from '../hooks/useDraftGuideBoard';
import { useProviderAdpBoards } from '../hooks/useProviderAdpBoards';
import { useUnderdogAdp } from '../hooks/useUnderdogAdp';
import { useWeeklyStats } from '../hooks/useWeeklyStats';
import { useDraftSession } from '../session/DraftSessionProvider';
import { DraftGuideFilters, type GuideSourceOption } from '../components/DraftGuideFilters';
import { DraftGuideTable } from '../components/DraftGuideTable';
import { DraftGuideBoard } from '../components/DraftGuideBoard';
import { PlayerDetailDrawer, type AdpDisclosure } from '../components/PlayerDetailDrawer';

/** Marketing-constrained copy (DECISIONS.md, 2026-08-25): describes methodology, claims nothing
 * about beating ADP or winning leagues. */
const METHODOLOGY_NOTE =
  'Engine ranking: projected roster value \u2014 marginal roster utility over an empty roster, '
  + 'computed from FFToday season projections scored in your league\u2019s format. Availability '
  + 'signals are experimental. The \u0394 column describes disagreement vs Sleeper ADP, not superiority.';

const SOURCE_LABELS: Readonly<Record<GuideRankSource, string>> = {
  engine: 'Engine',
  sleeper: 'Sleeper ADP',
  espn: 'ESPN',
  ffc: 'FFC',
  underdog: 'Underdog best-ball',
};

/** The public, no-account Draft Guide (`/draft-guide`). Selector state lives entirely in the URL
 * query string — an anonymous user writes nothing (no storage, no server). */
export function DraftGuideRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const format = useMemo(() => parseGuideFormat(searchParams), [searchParams]);
  const source = (searchParams.get('source') ?? 'engine') as GuideRankSource;
  // An unknown pos param degrades to ALL rather than silently filtering every row away (the same
  // degrade-don't-crash contract as activeSource below).
  const rawPos = searchParams.get('pos');
  const position: Position | 'ALL' = rawPos != null && (GUIDE_POSITIONS as readonly string[]).includes(rawPos)
    ? rawPos as Position | 'ALL'
    : 'ALL';
  // Two views of one ranked pool — a sortable table and a snake draft grid. Like every other
  // guide selector, the choice lives in the URL; unknown values degrade to the table. The grid is
  // a FULL-board view: under a position filter it's disabled (and a `view=draft` deep link
  // degrades to the table, keeping the param so clearing the filter restores the grid) — a
  // filtered pool would misrepresent where players actually get picked.
  const gridAvailable = position === 'ALL';
  const view: 'table' | 'draft' = searchParams.get('view') === 'draft' && gridAvailable ? 'draft' : 'table';

  const { manifest } = useDraftSession();
  const board = useDraftGuideBoard(format);
  const adpFormat = guideAdpFormat(format);
  const providerLanes = useProviderAdpBoards(adpFormat);
  const underdog = useUnderdogAdp();

  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  function updateParams(patch: Record<string, string>) {
    // Merge into the CURRENT query string: setSearchParams replaces the whole query, so building
    // a fresh URLSearchParams from only the patch would silently reset every selector absent
    // from it (changing source would wipe scoring/qb/teams/rounds/pos and vice versa).
    const next = new URLSearchParams(searchParams);
    // Absent keys fall back to defaults inside parseGuideFormat — no storage anywhere.
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  function patchFormat(patch: Partial<typeof format>) {
    updateParams(Object.fromEntries(serializeGuideFormat({ ...format, ...patch })));
  }

  // Provider lanes are display-only: they re-sort rows the engine already produced and never
  // re-run the engine on their own artifacts (guideProviderColumns.ts's module doc).
  const espnEntries = providerLanes.find((lane) => lane.key === 'espn-ppr' && lane.status === 'ready')?.entries;
  const ffcEntries = providerLanes.find((lane) => lane.key === `ffc-${adpFormat}` && lane.status === 'ready')?.entries;
  const columns = useMemo(() => ({
    sleeper: buildProviderColumn('sleeper', SOURCE_LABELS.sleeper, board.adp),
    espn: espnEntries ? buildProviderColumn('espn', SOURCE_LABELS.espn, espnEntries) : unavailableProviderColumn('espn', SOURCE_LABELS.espn),
    ffc: ffcEntries ? buildProviderColumn('ffc', SOURCE_LABELS.ffc, ffcEntries) : unavailableProviderColumn('ffc', SOURCE_LABELS.ffc),
    underdog: underdog.status === 'ready'
      ? buildProviderColumn('underdog', SOURCE_LABELS.underdog, underdog.entries)
      : unavailableProviderColumn('underdog', SOURCE_LABELS.underdog),
  }), [board.adp, espnEntries, ffcEntries, underdog]);

  const sourceOptions: GuideSourceOption[] = [
    { key: 'engine', label: SOURCE_LABELS.engine, status: board.status === 'error' ? 'unavailable' : 'ready' },
    { key: 'sleeper', label: SOURCE_LABELS.sleeper, status: 'ready' },
    { key: 'espn', label: SOURCE_LABELS.espn, status: columns.espn.status },
    { key: 'ffc', label: SOURCE_LABELS.ffc, status: columns.ffc.status },
    { key: 'underdog', label: SOURCE_LABELS.underdog, status: columns.underdog.status },
  ];

  // An unavailable or unknown source in the URL degrades to the engine rather than erroring.
  const activeSource: GuideRankSource = sourceOptions.some((o) => o.key === source && o.status === 'ready')
    ? source
    : 'engine';

  const visibleRows = useMemo(() => {
    // Fresh position filter — no live-draft rules (All includes K/DEF; QB never auto-drops).
    const filtered = position === 'ALL'
      ? board.rows
      : board.rows.filter((row) => row.player?.position === position);
    return sortGuideRows(filtered, activeSource, columns, board.engineRankByPlayer);
  }, [board.rows, board.engineRankByPlayer, activeSource, columns, position]);

  // Per-position ranks (the `RB1` chip) over the FULL pool — a player's chip must not change
  // because the position filter or view hid their peers.
  const positionRankByPlayer = useMemo(() => buildPositionRankByPlayer(board.rows), [board.rows]);

  // When each lane's artifact was fetched (the disclosure line + the header's last-updated label).
  function laneFetchedAt(key: 'sleeper' | 'espn' | 'ffc' | 'underdog'): string | null {
    const source = key === 'sleeper'
      ? manifest?.sources[`adp_active_${adpFormat}`]
      : key === 'espn'
        ? manifest?.sources.espn_adp_ppr
        : key === 'ffc'
          ? manifest?.sources[`ffc_adp_${adpFormat}`]
          : manifest?.sources.underdog_bestball;
    return source?.fetchedAt ?? null;
  }
  const latestAdpFetchedAt = useMemo(() => {
    // ISO timestamps sort lexicographically — max() as a string is the newest.
    let latest: string | null = null;
    for (const key of ['sleeper', 'espn', 'ffc', 'underdog'] as const) {
      if (columns[key].status !== 'ready') continue;
      const fetchedAt = laneFetchedAt(key);
      if (fetchedAt != null && (latest == null || fetchedAt > latest)) latest = fetchedAt;
    }
    return latest;
    // laneFetchedAt reads only manifest/adpFormat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, manifest, adpFormat]);
  const adpUpdatedLabel = formatRelativeAge(latestAdpFetchedAt, Date.now());

  // The STACKED-style table's provider columns, in display order. All four keep their slot even
  // when unavailable (honest absence — em-dash columns, never vanishing options).
  const lanes: GuideLane[] = useMemo(() => ([
    { key: 'espn', label: SOURCE_LABELS.espn, brandKey: 'espn', status: columns.espn.status, rankByPlayer: columns.espn.rankByPlayer, adpByPlayer: columns.espn.adpByPlayer },
    { key: 'sleeper', label: SOURCE_LABELS.sleeper, brandKey: 'sleeper', status: columns.sleeper.status, rankByPlayer: columns.sleeper.rankByPlayer, adpByPlayer: columns.sleeper.adpByPlayer },
    { key: 'ffc', label: SOURCE_LABELS.ffc, brandKey: 'ffc', status: columns.ffc.status, rankByPlayer: columns.ffc.rankByPlayer, adpByPlayer: columns.ffc.adpByPlayer },
    { key: 'underdog', label: SOURCE_LABELS.underdog, brandKey: 'underdog', status: columns.underdog.status, rankByPlayer: columns.underdog.rankByPlayer, adpByPlayer: columns.underdog.adpByPlayer },
  ]), [columns]);

  const anchorRankByPlayer = activeSource === 'engine' ? board.engineRankByPlayer : columns[activeSource].rankByPlayer;

  function handleExportCsv() {
    const anchorRank = (row: GuideRow) => anchorRankByPlayer.get(row.playerId) ?? null;
    const csv = serializeGuideCsv(visibleRows, [
      { header: `${SOURCE_LABELS[activeSource]} rank`, value: (row) => String(anchorRank(row) ?? '') },
      { header: 'Player', value: (row) => row.player?.name ?? row.playerId },
      { header: 'Pos', value: (row) => row.player?.position ?? '' },
      { header: 'Team', value: (row) => row.player?.team ?? '' },
      ...lanes.flatMap((lane) => [
        {
          header: `${lane.label} ADP`,
          value: (row: GuideRow) => {
            const cell = buildLaneCell(lane, row.playerId, anchorRank(row));
            return cell.adp == null ? '' : cell.adp.toFixed(1);
          },
        },
        {
          header: `${lane.label} dVsAnchor`,
          value: (row: GuideRow) => {
            const cell = buildLaneCell(lane, row.playerId, anchorRank(row));
            return cell.delta == null || Math.abs(cell.delta) < 0.05 ? '' : cell.delta.toFixed(1);
          },
        },
      ]),
    ]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'draft-guide.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const selectedPlayer = selectedPlayerId != null ? board.playersById.get(selectedPlayerId) : undefined;
  // Looked up in the FULL row universe, not visibleRows: changing the position filter while the
  // drawer is open must not strip a recommendation the board already computed.
  const selectedRecommendation = selectedPlayerId != null
    ? board.rows.find((row) => row.playerId === selectedPlayerId)?.recommendation ?? undefined
    : undefined;
  const contextFeedStatus = resolvePlayerContextFeedStatus(manifest?.sources, board.usageLoadStatus);

  // Drawer context plumbing — the guide's PlayerDetailDrawer gets the SAME rich context the live
  // room's does (RecommendationBoard.tsx lines 665-684), from data this route already holds:
  // - weeklyStats lazy-loads only while a player is open (`useWeeklyStats`'s contract);
  // - depth roles build from the public usage artifact once the context feed is ready;
  // - adpDisclosure names whichever upstream actually won `adp_active_<format>` (never a silent
  //   mislabel on a fallback day).
  const guideSeason = manifest != null ? Number(manifest.season) : null;
  const weeklyStats = useWeeklyStats(selectedPlayerId, guideSeason != null && Number.isFinite(guideSeason) ? guideSeason : null);
  const guidePlayers = useMemo(() => [...board.playersById.values()], [board.playersById]);
  const depthRoleByPlayer = useMemo(
    () => buildTeamDepthRoles(guidePlayers, contextFeedStatus === 'ready' ? board.usage : {}),
    [guidePlayers, contextFeedStatus, board.usage],
  );
  const activeAdpSource = manifest?.sources[`adp_active_${adpFormat}`];
  const ffcAdpSource = manifest?.sources[`ffc_adp_${adpFormat}`];
  const adpDisclosure: AdpDisclosure | null = activeAdpSource == null
    ? null
    : activeAdpSource.activeAdpSource === 'ffc-fallback'
      ? {
          source: 'ffc-fallback',
          mockDrafts: ffcAdpSource?.population?.mockDrafts ?? null,
          teams: ffcAdpSource?.population?.teams ?? 12,
          format: ffcAdpSource?.population?.format ?? adpFormat,
        }
      : activeAdpSource.activeAdpSource === 'espn'
        ? { source: 'espn', format: adpFormat }
        : { source: 'sleeper', format: adpFormat };

  return (
    <section className="draft-guide" aria-label="Draft Guide">
      <div className="guide-header">
        <div className="guide-header-heading">
          <p className="eyebrow">Draft Guide</p>
          <h2>The board, before draft day</h2>
        </div>
        <div className="guide-header-actions">
          {adpUpdatedLabel && <p className="guide-updated">ADPs last updated {adpUpdatedLabel}</p>}
          <button
            type="button"
            className="quiet-button"
            onClick={handleExportCsv}
            disabled={board.status !== 'ready'}
            title="Download the current view as CSV"
          >
            Export CSV
          </button>
        </div>
      </div>

      <DraftGuideFilters
        format={format}
        onFormatChange={patchFormat}
        source={activeSource}
        onSourceChange={(next) => updateParams({ source: next })}
        sources={sourceOptions}
        position={position}
        onPositionChange={(pos) => updateParams({ pos: pos === 'ALL' ? '' : pos })}
      />

      {board.status === 'loading' && <p className="guide-loading">Loading the board…</p>}
      {board.status === 'error' && (
        <p className="guide-loading">The projection board is unavailable right now — try again shortly.</p>
      )}

      {board.status === 'ready' && (
        <>
          <div className="guide-view-toggle" role="group" aria-label="Board view">
            <button
              type="button"
              className="quiet-button guide-view-button"
              aria-pressed={view === 'table'}
              onClick={() => updateParams({ view: '' })}
            >
              Table
            </button>
            <button
              type="button"
              className="quiet-button guide-view-button"
              aria-pressed={view === 'draft'}
              disabled={!gridAvailable}
              title={gridAvailable ? undefined : 'The draft grid shows the full board — set the position filter back to All to use it.'}
              onClick={() => updateParams({ view: 'draft' })}
            >
              Draft grid
            </button>
            {!gridAvailable && (
              <span className="guide-view-note">The draft grid shows the full board — set the position filter back to All to use it.</span>
            )}
          </div>

          {view === 'draft' ? (
            <DraftGuideBoard
              rows={visibleRows}
              teams={format.teams}
              rounds={format.rounds}
              sourceRankByPlayer={activeSource === 'engine' ? board.engineRankByPlayer : columns[activeSource].rankByPlayer}
              positionRankByPlayer={positionRankByPlayer}
              onSelectPlayer={setSelectedPlayerId}
            />
          ) : (
            <DraftGuideTable
              rows={visibleRows}
              anchorLabel={SOURCE_LABELS[activeSource]}
              anchorRankByPlayer={anchorRankByPlayer}
              positionRankByPlayer={positionRankByPlayer}
              lanes={lanes}
              onSelectPlayer={setSelectedPlayerId}
            />
          )}
        </>
      )}

      <details className="guide-methodology-note">
        <summary>Methodology &amp; data sources</summary>
        <p className="guide-methodology">{METHODOLOGY_NOTE}</p>
        <ul className="guide-disclosure">
          {(['sleeper', 'espn', 'ffc', 'underdog'] as const).map((key) => {
            const column: ProviderColumn = columns[key];
            const fetchedAt = laneFetchedAt(key);
            return (
              <li key={key} className="guide-lane-note" data-status={column.status}>
                <strong>{SOURCE_LABELS[key]}</strong>
                {' '}
                {column.status === 'ready'
                  ? `${column.rowCount} rows · data ${fetchedAt ? new Date(fetchedAt).toLocaleDateString() : 'age unknown'}`
                  : 'unavailable'}
                {' — '}
                {LANE_NOTES[key]}
              </li>
            );
          })}
        </ul>
      </details>

      {selectedPlayer && (
        <PlayerDetailDrawer
          player={selectedPlayer}
          usage={board.usage[selectedPlayer.playerId]}
          usageArtifact={board.usage}
          players={[...board.playersById.values()]}
          feedStatus={contextFeedStatus}
          recommendation={selectedRecommendation}
          fallbackProjectedPoints={selectedRecommendation?.projectedPoints ?? null}
          adpDisclosure={adpDisclosure}
          weeklyStats={weeklyStats}
          adpBoard={board.adp}
          underdogAdp={underdog.entries}
          providerAdpLanes={providerLanes.filter((lane) => lane.status === 'ready')}
          providerProjectionsArtifact={board.providerProjectionsArtifact}
          settings={board.settings}
          depthRole={depthRoleByPlayer.get(selectedPlayer.playerId) ?? null}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </section>
  );
}





