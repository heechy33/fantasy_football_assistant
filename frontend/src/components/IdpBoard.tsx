import { useMemo, useState } from 'react';
import type { Pick } from '../../../shared/types';
import {
  getDraftedIdpNames,
  loadIdpPlayers,
  type IdpPlayer,
  type IdpSlot,
} from '../data/idpProjections';
import { IdpDetailDrawer } from './IdpDetailDrawer';

export interface IdpBoardProps {
  initialSlot?: IdpSlot;
  effectivePicks?: readonly Pick[];
  onDraftPlayer?: (playerName: string) => void;
  onSelectPlayer?: (player: IdpPlayer) => void;
  showDraftButton?: boolean;
}

export function IdpBoard({
  initialSlot = 'D',
  effectivePicks = [],
  onDraftPlayer: _onDraftPlayer,
  onSelectPlayer,
}: IdpBoardProps) {
  const [activeSlot, setActiveSlot] = useState<IdpSlot>(initialSlot);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<IdpPlayer | null>(null);

  const draftedNames = useMemo(
    () => getDraftedIdpNames(effectivePicks),
    [effectivePicks],
  );

  const players = useMemo(
    () => loadIdpPlayers(activeSlot),
    [activeSlot],
  );

  const filteredPlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q) ||
        p.pos.toLowerCase().includes(q),
    );
  }, [players, searchQuery]);

  return (
    <div className="idp-board-container" data-testid="idp-board">
      <div className="idp-board-header">
        <div className="idp-slot-tabs" role="tablist" aria-label="Defensive positions">
          <button
            type="button"
            role="tab"
            aria-selected={activeSlot === 'D'}
            className={`idp-slot-tab ${activeSlot === 'D' ? 'active' : ''}`}
            onClick={() => setActiveSlot('D')}
          >
            D (DE / LB)
            <span className="idp-tab-count">180</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSlot === 'S'}
            className={`idp-slot-tab ${activeSlot === 'S' ? 'active' : ''}`}
            onClick={() => setActiveSlot('S')}
          >
            S (DB / Safety)
            <span className="idp-tab-count">100</span>
          </button>
        </div>

        <div className="idp-search-wrap">
          <input
            type="text"
            className="idp-search-input"
            placeholder="Search defender by name, team, or pos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Filter defensive players"
          />
          {searchQuery && (
            <button
              type="button"
              className="idp-clear-search"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="idp-table-scroll-wrap">
        <table className="idp-table">
          <thead>
            <tr>
              <th className="th-rank">Rank</th>
              <th className="th-name">Player</th>
              <th className="th-pos">Pos</th>
              <th className="th-team">Team</th>
              <th className="th-bye">Bye</th>
              <th className="th-fpts">Proj FPTS</th>
              <th className="th-stat">Solo / Ast</th>
              <th className="th-stat">Sacks</th>
              <th className="th-stat">INT</th>
              <th className="th-stat">PD</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlayers.length === 0 ? (
              <tr>
                <td colSpan={10} className="idp-empty-state">
                  No defensive players found matching &ldquo;{searchQuery}&rdquo;.
                </td>
              </tr>
            ) : (
              filteredPlayers.map((player) => {
                const isDrafted = draftedNames.has(player.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
                return (
                  <tr
                    key={player.id}
                    className={`idp-player-row ${isDrafted ? 'is-drafted' : ''} interactive`}
                    onClick={() => {
                      setSelectedPlayer(player);
                      onSelectPlayer?.(player);
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View details for ${player.name}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedPlayer(player);
                        onSelectPlayer?.(player);
                      }
                    }}
                  >
                    <td className="td-rank">#{player.rank}</td>
                    <td className="td-name">
                      <strong>{player.name}</strong>
                      {isDrafted ? (
                        <span className="idp-drafted-chip">Drafted</span>
                      ) : null}
                    </td>
                    <td className="td-pos">
                      <span className="idp-pos-pill">{player.pos}</span>
                    </td>
                    <td className="td-team">{player.team}</td>
                    <td className="td-bye">{player.bye ?? '—'}</td>
                    <td className="td-fpts">
                      <span className="idp-fpts-value">{player.projectedPoints.toFixed(1)}</span>
                    </td>
                    <td className="td-stat">
                      {player.tackles} / {player.assists}
                    </td>
                    <td className="td-stat">{player.sacks}</td>
                    <td className="td-stat">{player.int}</td>
                    <td className="td-stat">{player.pd}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedPlayer && (
        <IdpDetailDrawer
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}
