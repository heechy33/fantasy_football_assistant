import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { resolvePlayerContextFeedStatus } from '../data/playerContext';
import {
  parseGuideFormat,
  serializeGuideFormat,
  guideAdpFormat,
  ALL_GUIDE_POSITIONS,
  type GuidePosition,
} from '../data/guideLeagueSettings';
import { IdpBoard } from '../components/IdpBoard';
import { buildProviderColumn, unavailableProviderColumn, type GuideRankSource } from '../data/guideProviderColumns';
import { buildPositionRankByPlayer, type GuideLane } from '../data/guideTableColumns';
import { buildTeamDepthRoles } from '../data/teamDepthRole';
import { sortGuideRows } from '../data/guideBoard';
import { useDraftGuideBoard } from '../hooks/useDraftGuideBoard';
import { useProviderAdpBoards } from '../hooks/useProviderAdpBoards';
import { useUnderdogAdp } from '../hooks/useUnderdogAdp';
import { useWeeklyStats } from '../hooks/useWeeklyStats';
import { useDraftSession } from '../session/DraftSessionProvider';
import { DraftGuideFilters } from '../components/DraftGuideFilters';
import { DraftGuideTable } from '../components/DraftGuideTable';
import { DraftGuideBoard } from '../components/DraftGuideBoard';
import { PlayerDetailDrawer, type AdpDisclosure } from '../components/PlayerDetailDrawer';

const SOURCE_LABELS: Readonly<Record<GuideRankSource, string>> = {
  engine: 'Engine',
  sleeper: 'Sleeper',
  espn: 'ESPN',
  ffc: 'FFC',
  yahoo: 'Yahoo',
  underdog: 'Underdog',
};

/** The board's anchor ADP lane ("Rank" column). No UI selector anymore — Sleeper is the board
 * order and the other providers are reference columns; a `source=` deep link still honors an
 * explicit lane, degrading to Sleeper for unknown values. */
const ADP_SOURCE_KEYS = ['sleeper', 'espn', 'yahoo', 'underdog'] as const;
type AdpSourceKey = (typeof ADP_SOURCE_KEYS)[number];

/** Both views cap the displayed pool at 1000 players (STACKED showed until 1000) — deep best-ball
 * pools beyond that are noise on a public board. The full pool still feeds the drawer lookups. */
const GUIDE_MAX_ROWS = 1000;

/** The public, no-account Draft Guide (`/draft-guide`). Selector state lives entirely in the URL
 * query string — an anonymous user writes nothing (no storage, no server). */
export function DraftGuideRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const format = useMemo(() => parseGuideFormat(searchParams), [searchParams]);
  const source = (searchParams.get('source') ?? 'sleeper') as GuideRankSource;
  const activeSource: AdpSourceKey = (ADP_SOURCE_KEYS as readonly string[]).includes(source)
    ? source as AdpSourceKey
    : 'sleeper';
  // An unknown pos param degrades to ALL rather than silently filtering every row away (the same
  // degrade-don't-crash contract as activeSource below).
  const rawPos = searchParams.get('pos');
  const position: GuidePosition = rawPos != null && (ALL_GUIDE_POSITIONS as readonly string[]).includes(rawPos)
    ? rawPos as GuidePosition
    : 'ALL';
  const isIdp = position === 'D' || position === 'S';
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
  const yahooEntries = providerLanes.find((lane) => lane.key === `yahoo-${adpFormat}` && lane.status === 'ready')?.entries;
  const columns = useMemo(() => ({
    sleeper: buildProviderColumn('sleeper', SOURCE_LABELS.sleeper, board.adp),
    espn: espnEntries ? buildProviderColumn('espn', SOURCE_LABELS.espn, espnEntries) : unavailableProviderColumn('espn', SOURCE_LABELS.espn),
    ffc: unavailableProviderColumn('ffc', SOURCE_LABELS.ffc),
    yahoo: yahooEntries ? buildProviderColumn('yahoo', SOURCE_LABELS.yahoo, yahooEntries) : unavailableProviderColumn('yahoo', SOURCE_LABELS.yahoo),
    underdog: underdog.status === 'ready'
      ? buildProviderColumn('underdog', SOURCE_LABELS.underdog, underdog.entries)
      : unavailableProviderColumn('underdog', SOURCE_LABELS.underdog),
  }), [board.adp, espnEntries, yahooEntries, underdog]);

  const visibleRows = useMemo(() => {
    // Fresh position filter — no live-draft rules (All includes K/DEF; QB never auto-drops).
    const filtered = position === 'ALL'
      ? board.rows
      : board.rows.filter((row) => row.player?.position === position);
    return sortGuideRows(filtered, activeSource, columns, board.engineRankByPlayer).slice(0, GUIDE_MAX_ROWS);
  }, [board.rows, board.engineRankByPlayer, activeSource, columns, position]);

  // Per-position ranks (the `RB1` chip) over the FULL pool — a player's chip must not change
  // because the position filter or view hid their peers.
  const positionRankByPlayer = useMemo(() => buildPositionRankByPlayer(board.rows), [board.rows]);

  // The STACKED-style table's provider columns, in display order. All four keep their slot even
  // when unavailable (honest absence — em-dash columns, never vanishing options).
  const lanes: GuideLane[] = useMemo(() => ([
    { key: 'espn', label: SOURCE_LABELS.espn, brandKey: 'espn', status: columns.espn.status, rankByPlayer: columns.espn.rankByPlayer, adpByPlayer: columns.espn.adpByPlayer },
    { key: 'sleeper', label: SOURCE_LABELS.sleeper, brandKey: 'sleeper', status: columns.sleeper.status, rankByPlayer: columns.sleeper.rankByPlayer, adpByPlayer: columns.sleeper.adpByPlayer },
    { key: 'yahoo', label: SOURCE_LABELS.yahoo, brandKey: 'yahoo', status: columns.yahoo.status, rankByPlayer: columns.yahoo.rankByPlayer, adpByPlayer: columns.yahoo.adpByPlayer },
    { key: 'underdog', label: SOURCE_LABELS.underdog, brandKey: 'underdog', status: columns.underdog.status, rankByPlayer: columns.underdog.rankByPlayer, adpByPlayer: columns.underdog.adpByPlayer },
  ]), [columns]);

  const anchorRankByPlayer = columns[activeSource].rankByPlayer;

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
  // The two full-pool derivations below (players array spread + buildTeamDepthRoles) only exist
  // for the drawer, so they're gated on it being open — with the drawer closed (the default
  // view) they cost nothing instead of re-running on every usage/manifest change.
  const drawerOpen = selectedPlayerId != null;
  const guideSeason = manifest != null ? Number(manifest.season) : null;
  const weeklyStats = useWeeklyStats(drawerOpen ? selectedPlayerId : null, guideSeason != null && Number.isFinite(guideSeason) ? guideSeason : null);
  const guidePlayers = useMemo(
    () => (drawerOpen ? [...board.playersById.values()] : []),
    [drawerOpen, board.playersById],
  );
  const depthRoleByPlayer = useMemo(
    () => (drawerOpen ? buildTeamDepthRoles(guidePlayers, contextFeedStatus === 'ready' ? board.usage : {}) : new Map() as ReturnType<typeof buildTeamDepthRoles>),
    [drawerOpen, guidePlayers, contextFeedStatus, board.usage],
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
          startDate: ffcAdpSource?.population?.startDate ?? null,
          endDate: ffcAdpSource?.population?.endDate ?? null,
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
      </div>

      {/* One toolbar row: the format/position filters on the left, the view toggle on the right.
          The filters render regardless of board status — deep-link degrade tests rely on being
          able to read/click them while the board is still loading or errored. */}
      <div className="guide-toolbar">
        <DraftGuideFilters
          format={format}
          onFormatChange={patchFormat}
          position={position}
          onPositionChange={(pos) => updateParams({ pos: pos === 'ALL' ? '' : pos })}
        />
        {!isIdp && board.status === 'ready' && (
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
              onClick={() => updateParams({ view: 'draft' })}
            >
              Draft
            </button>
          </div>
        )}
      </div>

      {isIdp ? (
        <IdpBoard
          key={position}
          initialSlot={position}
          showDraftButton={false}
        />
      ) : (
        <>
          {board.status === 'loading' && <p className="guide-loading">Loading the board…</p>}
          {board.status === 'error' && (
            <p className="guide-loading">The projection board is unavailable right now — try again shortly.</p>
          )}

          {board.status === 'ready' && (
            <>
              {view === 'draft' ? (
                <DraftGuideBoard
                  rows={visibleRows}
                  teams={format.teams}
                  rounds={format.rounds}
                  sourceRankByPlayer={columns[activeSource].rankByPlayer}
                  positionRankByPlayer={positionRankByPlayer}
                  onSelectPlayer={setSelectedPlayerId}
                />
              ) : (
                <DraftGuideTable
                  rows={visibleRows}
                  anchorLabel="Rank"
                  anchorRankByPlayer={anchorRankByPlayer}
                  positionRankByPlayer={positionRankByPlayer}
                  lanes={lanes}
                  onSelectPlayer={setSelectedPlayerId}
                />
              )}
            </>
          )}
        </>
      )}

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





