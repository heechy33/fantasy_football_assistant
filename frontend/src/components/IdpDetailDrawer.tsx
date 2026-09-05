import { useState, type KeyboardEvent } from 'react';
import type { IdpPlayer, IdpWeeklyGame } from '../data/idpProjections';
import { buildIdpPercentileRankings } from '../data/idpPercentileRankings';
import { Drawer } from './Drawer';
import { PositionBadge } from './PositionBadge';
import { PlayerPortrait } from './PlayerPortrait';
import { PercentileBar } from './PercentileBar';
import { teamLogoUrl } from '../data/playerPortrait';

export interface IdpDetailDrawerProps {
  player: IdpPlayer;
  onClose: () => void;
}

type IdpDetailTab = 'overview' | 'role' | 'weekly';

const DETAIL_TABS: readonly IdpDetailTab[] = ['overview', 'role', 'weekly'];
const TAB_LABEL: Record<IdpDetailTab, string> = {
  overview: 'Overview',
  role: 'Role',
  weekly: 'Weekly',
};

export function IdpDetailDrawer({ player, onClose }: IdpDetailDrawerProps) {
  const [tab, setTab] = useState<IdpDetailTab>('overview');
  const [weeklyView, setWeeklyView] = useState<'graph' | 'table'>('graph');
  const [hoveredWeek, setHoveredWeek] = useState<IdpWeeklyGame | null>(null);

  const bio = player.bio;
  const role = player.role;
  const weekly = player.weekly ?? [];
  const playedGames = weekly.filter((g) => g.kind === 'played' && g.pts != null);
  const isRookie = (bio?.yearsExp === 0 || role?.gamesPlayed === 0);
  const rankings = buildIdpPercentileRankings(player);

  const logoUrl = teamLogoUrl(player.team);

  const bioItems: Array<{ label: string; value: string }> = [];
  if (bio?.age != null) bioItems.push({ label: 'Age', value: String(bio.age) });
  if (bio?.height) bioItems.push({ label: 'Height', value: bio.height });
  if (bio?.weight != null) bioItems.push({ label: 'Weight', value: `${bio.weight} lbs` });
  if (bio?.yearsExp != null) {
    bioItems.push({ label: 'Experience', value: bio.yearsExp === 0 ? 'Rookie' : `${bio.yearsExp} yrs` });
  }
  if (player.bye != null) bioItems.push({ label: 'Bye', value: `Week ${player.bye}` });
  if (bio?.jerseyNumber != null) bioItems.push({ label: 'No.', value: `#${bio.jerseyNumber}` });
  if (bio?.college?.trim()) bioItems.push({ label: 'College', value: bio.college.trim() });
  if (bio?.draftPick) bioItems.push({ label: 'Draft', value: bio.draftPick });

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = DETAIL_TABS.indexOf(tab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = DETAIL_TABS[(current + delta + DETAIL_TABS.length) % DETAIL_TABS.length] ?? 'overview';
      setTab(next);
    }
  }

  // Graph dimensions
  const chartWidth = 640;
  const chartHeight = 200;
  const paddingX = 40;
  const paddingY = 24;
  const plotWidth = chartWidth - paddingX * 2;
  const plotHeight = chartHeight - paddingY * 2;
  const maxPts = Math.max(20, ...weekly.map((g) => g.pts ?? 0));

  return (
    <Drawer open size="wide" label={player.name} team={player.team} className="player-detail-drawer" onClose={onClose}>
      <div
        className="player-detail-tabs"
        role="tablist"
        aria-label="Defensive player detail sections"
        onKeyDown={handleTabKeyDown}
      >
        {DETAIL_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            id={`idp-detail-tab-${id}`}
            className="player-detail-tab"
            onClick={() => setTab(id)}
          >
            {TAB_LABEL[id]}
          </button>
        ))}
      </div>

      <div className="idp-detail-hero" data-team={player.team}>
        {logoUrl && (
          <img
            src={logoUrl}
            alt=""
            className="idp-hero-watermark"
            aria-hidden="true"
          />
        )}

        <div className="idp-detail-hero-content">
          <div className="idp-detail-headline">
            <div className="idp-detail-title-wrap">
              <h2 className="idp-detail-name">{player.name}</h2>
              <div className="idp-detail-subhead">
                <PositionBadge position={player.pos} />
                <span className="idp-slot-chip">Yahoo Slot {player.slot}</span>
                <span className="idp-meta-team">
                  {logoUrl && <img src={logoUrl} alt="" className="idp-team-mini-logo" width={18} height={18} />}
                  {player.team}
                </span>
                {player.bye != null && <span className="idp-meta-bye">Bye {player.bye}</span>}
              </div>
            </div>
          </div>

          {bioItems.length > 0 && (
            <dl className="player-detail-bio idp-bio-grid">
              {bioItems.map((item) => (
                <div key={item.label} className="idp-bio-cell">
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="idp-hero-portrait-frame">
          <PlayerPortrait
            player={{
              playerId: player.sleeperId ?? player.id,
              name: player.name,
              position: player.pos as any,
              team: player.team,
            }}
            size="hero"
            className="idp-hero-portrait"
          />
        </div>
      </div>

      {tab === 'overview' && (
        <div className="player-detail-panel idp-overview-panel" role="tabpanel" aria-labelledby="idp-detail-tab-overview">
          <div className="idp-overview-cards">
            <section className="idp-overview-card" aria-labelledby="idp-proj-heading">
              {logoUrl && <img src={logoUrl} alt="" className="idp-card-watermark" aria-hidden="true" />}
              <div className="idp-card-header">
                <h3 id="idp-proj-heading">2026 Yahoo Projection</h3>
                <span className="idp-card-badge">FFToday</span>
              </div>
              <div className="idp-proj-headline">
                <div className="idp-proj-score">
                  <span className="idp-score-num">{player.projectedPoints.toFixed(1)}</span>
                  <span className="idp-score-label">Proj FPTS</span>
                </div>
                <div className="idp-proj-rank">
                  <span className="idp-rank-num">#{player.rank}</span>
                  <span className="idp-rank-label">Rank ({player.slot})</span>
                </div>
                <div className="idp-proj-rate">
                  <span className="idp-rate-num">{(player.projectedPoints / 17).toFixed(1)}</span>
                  <span className="idp-rate-label">Proj FPTS/G</span>
                </div>
              </div>

              <div className="idp-proj-stats-grid">
                <div className="idp-proj-stat">
                  <span className="stat-label">Tackles</span>
                  <span className="stat-val">{player.tackles} solo / {player.assists} ast ({player.tackles + player.assists} tot)</span>
                </div>
                <div className="idp-proj-stat">
                  <span className="stat-label">Sacks</span>
                  <span className="stat-val">{player.sacks}</span>
                </div>
                <div className="idp-proj-stat">
                  <span className="stat-label">Interceptions</span>
                  <span className="stat-val">{player.int}</span>
                </div>
                <div className="idp-proj-stat">
                  <span className="stat-label">Passes Defended</span>
                  <span className="stat-val">{player.pd}</span>
                </div>
                <div className="idp-proj-stat">
                  <span className="stat-label">Forced / Rec Fumbles</span>
                  <span className="stat-val">{player.ff} FF / {player.fr} FR</span>
                </div>
              </div>
            </section>

            <section className="idp-overview-card" aria-labelledby="idp-role-heading">
              {logoUrl && <img src={logoUrl} alt="" className="idp-card-watermark" aria-hidden="true" />}
              <div className="idp-card-header">
                <h3 id="idp-role-heading">2025 Season Summary</h3>
                {role?.formRating && (
                  <span className={`idp-card-badge idp-badge-${role.formRating.toLowerCase()}`}>
                    {role.formRating} Form
                  </span>
                )}
              </div>

              {isRookie ? (
                <div className="idp-rookie-box">
                  <div className="idp-rookie-badge">2026 Rookie</div>
                  <p className="idp-rookie-text">No prior NFL season game log. Evaluated purely on collegiate film and athletic profile.</p>
                </div>
              ) : (
                <>
                  <div className="idp-proj-headline">
                    <div className="idp-proj-score">
                      <span className="idp-score-num">{role?.fptsPerGame?.toFixed(1) ?? '—'}</span>
                      <span className="idp-score-label">2025 FPTS/G</span>
                    </div>
                    <div className="idp-proj-rank">
                      <span className="idp-rank-num">{role?.snapPct != null ? `${role.snapPct}%` : '—'}</span>
                      <span className="idp-rank-label">Snap Share</span>
                    </div>
                    <div className="idp-proj-rate">
                      <span className="idp-rate-num">{role?.gamesStarted} / {role?.gamesPlayed}</span>
                      <span className="idp-rate-label">GS / GP</span>
                    </div>
                  </div>

                  <div className="idp-proj-stats-grid">
                    <div className="idp-proj-stat">
                      <span className="stat-label">Tackles / G</span>
                      <span className="stat-val">{role?.tacklesPerGame} ({role?.soloPerGame} solo / {role?.astPerGame} ast)</span>
                    </div>
                    <div className="idp-proj-stat">
                      <span className="stat-label">Sacks / G (Total)</span>
                      <span className="stat-val">{role?.sacksPerGame} ({role?.totalSacks} tot)</span>
                    </div>
                    <div className="idp-proj-stat">
                      <span className="stat-label">TFL / G</span>
                      <span className="stat-val">{role?.tflPerGame}</span>
                    </div>
                    <div className="idp-proj-stat">
                      <span className="stat-label">PD / G</span>
                      <span className="stat-val">{role?.pdPerGame}</span>
                    </div>
                    <div className="idp-proj-stat">
                      <span className="stat-label">Takeaways</span>
                      <span className="stat-val">{role?.totalInt} INT · {role?.forcedFumbles} FF · {role?.fumbleRecoveries} FR</span>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}

      {tab === 'role' && (
        <div className="player-detail-panel idp-role-panel" role="tabpanel" aria-labelledby="idp-detail-tab-role">
          {isRookie || !rankings ? (
            <div className="idp-rookie-box">
              <div className="idp-rookie-badge">2026 Rookie</div>
              <p className="idp-rookie-text">
                Prior-season NFL defensive role metrics are unavailable for incoming rookies.
                Refer to 2026 projections for anticipated volume.
              </p>
            </div>
          ) : (
            <div className="percentile-groups">
              {rankings.groups.map((group) => (
                <div className="percentile-group" key={group.id}>
                  <div className="percentile-group-head">{group.label}</div>
                  {group.stats.map((stat) => {
                    const ariaLabel = stat.percentile != null
                      ? `${stat.label}: ${Math.round(stat.percentile)}th percentile, ${stat.display ?? 'n/a'}`
                      : `${stat.label}: percentile unavailable, ${stat.display ?? 'n/a'}`;
                    return (
                      <div
                        className="percentile-row"
                        key={stat.key}
                        data-missing={stat.percentile == null || undefined}
                      >
                        <span className="percentile-label">{stat.label}</span>
                        <PercentileBar percentile={stat.percentile} ariaLabel={ariaLabel} />
                        <span className="percentile-value">{stat.display ?? 'n/a'}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'weekly' && (
        <div className="player-detail-panel idp-weekly-panel" role="tabpanel" aria-labelledby="idp-detail-tab-weekly">
          <div className="idp-weekly-toolbar">
            <div className="idp-view-toggle" role="group" aria-label="Weekly view">
              <button
                type="button"
                className={`idp-toggle-btn ${weeklyView === 'graph' ? 'active' : ''}`}
                onClick={() => setWeeklyView('graph')}
              >
                Graph View
              </button>
              <button
                type="button"
                className={`idp-toggle-btn ${weeklyView === 'table' ? 'active' : ''}`}
                onClick={() => setWeeklyView('table')}
              >
                Game Log Table
              </button>
            </div>

            {role?.fptsPerGame != null && (
              <span className="idp-season-avg-badge">
                2025 Avg: <strong>{role.fptsPerGame.toFixed(1)} FPTS/G</strong>
              </span>
            )}
          </div>

          {isRookie ? (
            <div className="idp-rookie-box">
              <div className="idp-rookie-badge">2026 Rookie</div>
              <p className="idp-rookie-text">No 2025 NFL regular season game logs for this player.</p>
            </div>
          ) : weeklyView === 'graph' ? (
            <div className="idp-chart-container">
              <div className="idp-chart-tooltip-wrap">
                {hoveredWeek ? (
                  <div className="idp-chart-tooltip">
                    <strong>Week {hoveredWeek.week} {hoveredWeek.opponent ? `vs ${hoveredWeek.opponent}` : ''}</strong>
                    {hoveredWeek.kind === 'played' ? (
                      <span>
                        {hoveredWeek.pts?.toFixed(1)} FPTS · {hoveredWeek.tkl} Tkl ({hoveredWeek.solo} solo) · {hoveredWeek.sack} Sack · {hoveredWeek.snapPct != null ? `${hoveredWeek.snapPct}% Snaps` : ''}
                      </span>
                    ) : hoveredWeek.kind === 'bye' ? (
                      <span>BYE WEEK</span>
                    ) : (
                      <span>INACTIVE / DNP</span>
                    )}
                  </div>
                ) : (
                  <div className="idp-chart-tooltip-placeholder">Hover over a week to see game stats</div>
                )}
              </div>

              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="idp-weekly-chart-svg"
                role="img"
                aria-label="2025 weekly fantasy points chart"
              >
                {/* Horizontal guide lines */}
                {[0, 0.25, 0.5, 0.75, 1.0].map((frac) => {
                  const y = paddingY + plotHeight * (1 - frac);
                  const val = Math.round(maxPts * frac);
                  return (
                    <g key={frac} className="idp-chart-gridline">
                      <line x1={paddingX} y1={y} x2={chartWidth - paddingX} y2={y} />
                      <text x={paddingX - 8} y={y + 4} textAnchor="end" className="idp-chart-axis-label">
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* Season Avg Reference Line */}
                {role?.fptsPerGame != null && (
                  <line
                    x1={paddingX}
                    y1={paddingY + plotHeight * (1 - role.fptsPerGame / maxPts)}
                    x2={chartWidth - paddingX}
                    y2={paddingY + plotHeight * (1 - role.fptsPerGame / maxPts)}
                    className="idp-chart-avg-line"
                  />
                )}

                {/* Bars / Points for each week */}
                {weekly.map((g, idx) => {
                  const x = paddingX + (idx / 17) * plotWidth;
                  const pts = g.pts ?? 0;
                  const y = paddingY + plotHeight * (1 - pts / maxPts);
                  const isHovered = hoveredWeek?.week === g.week;

                  if (g.kind === 'bye') {
                    return (
                      <g
                        key={g.week}
                        className="idp-chart-point bye"
                        onMouseEnter={() => setHoveredWeek(g)}
                        onMouseLeave={() => setHoveredWeek(null)}
                      >
                        <line x1={x} y1={paddingY} x2={x} y2={paddingY + plotHeight} strokeDasharray="2 2" />
                        <text x={x} y={paddingY + plotHeight + 16} textAnchor="middle" className="idp-week-axis-label">
                          {g.week}
                        </text>
                        <circle cx={x} cy={paddingY + plotHeight} r={isHovered ? 5 : 3} className="idp-dot-bye" />
                      </g>
                    );
                  }

                  if (g.kind === 'inactive') {
                    return (
                      <g
                        key={g.week}
                        className="idp-chart-point inactive"
                        onMouseEnter={() => setHoveredWeek(g)}
                        onMouseLeave={() => setHoveredWeek(null)}
                      >
                        <text x={x} y={paddingY + plotHeight + 16} textAnchor="middle" className="idp-week-axis-label">
                          {g.week}
                        </text>
                        <circle cx={x} cy={paddingY + plotHeight} r={isHovered ? 5 : 3} className="idp-dot-inactive" />
                      </g>
                    );
                  }

                  return (
                    <g
                      key={g.week}
                      className="idp-chart-point played"
                      onMouseEnter={() => setHoveredWeek(g)}
                      onMouseLeave={() => setHoveredWeek(null)}
                    >
                      <line x1={x} y1={paddingY + plotHeight} x2={x} y2={y} className="idp-bar-stem" />
                      <circle cx={x} cy={y} r={isHovered ? 7 : 4.5} className="idp-dot-played" />
                      <text x={x} y={paddingY + plotHeight + 16} textAnchor="middle" className="idp-week-axis-label">
                        {g.week}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : (
            <div className="idp-table-scroll-wrap">
              <table className="idp-game-log-table">
                <thead>
                  <tr>
                    <th>Wk</th>
                    <th>Opp</th>
                    <th>FPTS</th>
                    <th>Snap%</th>
                    <th>Solo</th>
                    <th>Ast</th>
                    <th>Tot</th>
                    <th>Sack</th>
                    <th>TFL</th>
                    <th>QBH</th>
                    <th>INT</th>
                    <th>PD</th>
                    <th>FF</th>
                    <th>FR</th>
                  </tr>
                </thead>
                <tbody>
                  {weekly.map((g) => {
                    if (g.kind === 'bye') {
                      return (
                        <tr key={g.week} className="idp-row-bye">
                          <td>{g.week}</td>
                          <td colSpan={13} className="idp-cell-status">BYE WEEK</td>
                        </tr>
                      );
                    }
                    if (g.kind === 'inactive') {
                      return (
                        <tr key={g.week} className="idp-row-inactive">
                          <td>{g.week}</td>
                          <td>{g.opponent ?? '—'}</td>
                          <td colSpan={12} className="idp-cell-status">Inactive / DNP</td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={g.week} className="idp-row-played">
                        <td className="td-wk">{g.week}</td>
                        <td className="td-opp">{g.opponent ?? '—'}</td>
                        <td className="td-fpts"><strong>{g.pts?.toFixed(1)}</strong></td>
                        <td className="td-snp">{g.snapPct != null ? `${g.snapPct}%` : '—'}</td>
                        <td>{g.solo}</td>
                        <td>{g.ast}</td>
                        <td><strong>{g.tkl}</strong></td>
                        <td>{g.sack > 0 ? g.sack.toFixed(1) : '—'}</td>
                        <td>{g.tfl > 0 ? g.tfl.toFixed(1) : '—'}</td>
                        <td>{g.qbHit > 0 ? g.qbHit : '—'}</td>
                        <td>{g.int > 0 ? <strong>{g.int}</strong> : '—'}</td>
                        <td>{g.pd > 0 ? g.pd : '—'}</td>
                        <td>{g.ff > 0 ? g.ff : '—'}</td>
                        <td>{g.fr > 0 ? g.fr : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="idp-table-totals">
                    <td colSpan={2}>Season Total ({playedGames.length} GP)</td>
                    <td><strong>{playedGames.reduce((acc, g) => acc + (g.pts ?? 0), 0).toFixed(1)}</strong></td>
                    <td>{role?.snapPct != null ? `${role.snapPct}%` : '—'}</td>
                    <td>{playedGames.reduce((acc, g) => acc + g.solo, 0)}</td>
                    <td>{playedGames.reduce((acc, g) => acc + g.ast, 0)}</td>
                    <td><strong>{playedGames.reduce((acc, g) => acc + g.tkl, 0)}</strong></td>
                    <td>{playedGames.reduce((acc, g) => acc + g.sack, 0).toFixed(1)}</td>
                    <td>{playedGames.reduce((acc, g) => acc + g.tfl, 0).toFixed(1)}</td>
                    <td>{playedGames.reduce((acc, g) => acc + g.qbHit, 0)}</td>
                    <td>{playedGames.reduce((acc, g) => acc + g.int, 0)}</td>
                    <td>{playedGames.reduce((acc, g) => acc + g.pd, 0)}</td>
                    <td>{playedGames.reduce((acc, g) => acc + g.ff, 0)}</td>
                    <td>{playedGames.reduce((acc, g) => acc + g.fr, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
