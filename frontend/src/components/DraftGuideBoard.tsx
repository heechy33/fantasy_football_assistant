import { useMemo, type CSSProperties } from 'react';
import type { PlayerId } from '../../../shared/types';
import { buildDraftGrid } from '../data/guideDraftGrid';
import { positionRankLabel } from '../data/guideTableColumns';
import type { GuideRow } from '../data/guideBoard';
import { PlayerAvatar } from './PlayerAvatar';
import { PlayerPortrait } from './PlayerPortrait';
import { teamLogoUrl } from '../data/playerPortrait';

// Same helper PlayerCard/PlayerBoardRow use for their team-logo watermark — a background-image
// custom property rather than an <img>, so a renamed-franchise 404 just doesn't paint.
function teamChromeStyle(team: string | null): CSSProperties {
  const logo = teamLogoUrl(team);
  return { '--team-logo': logo ? `url(${logo})` : 'none' } as CSSProperties;
}

export interface DraftGuideBoardProps {
  rows: readonly GuideRow[];
  teams: number;
  rounds: number;
  /** Dense 1-based ranks for the selected source — pick k renders the player whose rank is k. */
  sourceRankByPlayer: ReadonlyMap<PlayerId, number>;
  /** Per-position ranks (the `RB1` chip) over the full pool — optional; chips omit when absent. */
  positionRankByPlayer?: ReadonlyMap<PlayerId, number>;
  onSelectPlayer: (playerId: PlayerId) => void;
}

/** The guide's Draft View: a snake board where pick k renders the player whose source rank is k.
 * A real `<table>` — rows are rounds, columns are team slots, matching `draftOrder.ts`'s
 * convention exactly (see guideDraftGrid.ts). Picks no ranked row claims render visibly empty;
 * clicking a filled cell opens the same shared drawer as the table view. */
export function DraftGuideBoard({ rows, teams, rounds, sourceRankByPlayer, positionRankByPlayer, onSelectPlayer }: DraftGuideBoardProps) {
  const grid = useMemo(() => buildDraftGrid(rows, teams, rounds, sourceRankByPlayer), [rows, teams, rounds, sourceRankByPlayer]);

  return (
    <div className="guide-draft-scroll">
      <table className="guide-draft-grid" data-teams={teams}>
        <thead>
          <tr>
            <th scope="col" className="guide-grid-round-label">Round</th>
            {Array.from({ length: teams }, (_, i) => (
              <th scope="col" key={i + 1}>{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((roundCells, roundIndex) => (
            <tr key={roundIndex}>
              <th scope="row" className="guide-grid-round-label">{roundIndex + 1}</th>
              {roundCells.map((cell) => {
                const player = cell.row?.player;
                const posRank = cell.row != null && positionRankByPlayer != null
                  ? positionRankLabel(cell.row, positionRankByPlayer)
                  : null;
                return (
                  <td key={cell.overall} data-empty={cell.row == null || undefined}>
                    {cell.row == null ? (
                      <span className="guide-grid-empty">
                        <span aria-hidden="true">·</span>
                        <span className="visually-hidden">Pick {cell.overall}: unranked</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="guide-grid-cell"
                        data-team={player?.team ?? undefined}
                        style={teamChromeStyle(player?.team ?? null)}
                        onClick={() => onSelectPlayer(cell.row!.playerId)}
                        title={`${cell.row.player?.name ?? cell.row.playerId} \u2014 pick ${cell.overall} (round ${cell.round}, slot ${cell.slot})`}
                      >
                        {player ? (
                          <PlayerPortrait player={player} className="guide-grid-portrait" />
                        ) : (
                          <PlayerAvatar name={cell.row.player?.name ?? cell.row.playerId} team={null} />
                        )}
                        <span className="guide-grid-main">
                          <span className="guide-grid-top">
                            <span className="guide-grid-overall">#{cell.overall}</span>
                            <span className="guide-grid-name">{player?.name ?? cell.row.playerId}</span>
                          </span>
                          <span className="guide-grid-team">
                            {player?.team && (
                              <img
                                className="guide-grid-team-logo"
                                src={`/team-logos/${player.team.toLowerCase()}.png`}
                                alt=""
                                aria-hidden="true"
                                loading="lazy"
                              />
                            )}
                            {player?.team ?? 'FA'}
                            {posRank != null && (
                              <span className="guide-pos-pill guide-pos-pill-inline" data-position={player?.position ?? undefined}>
                                {posRank}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
