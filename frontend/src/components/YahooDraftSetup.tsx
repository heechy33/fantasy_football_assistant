import { useState, type FormEvent } from 'react';
import type { DraftInit, RosterSlot } from '../../../shared/types';

const YAHOO_TEAMS_OPTIONS = [8, 10, 12, 14] as const;
const YAHOO_FORMATS: ReadonlyArray<{ value: 'standard' | 'half-ppr' | 'ppr'; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'half-ppr', label: 'Half-PPR' },
  { value: 'ppr', label: 'Full PPR' },
];

function defaultYahooScoring(reception: 'standard' | 'half-ppr' | 'ppr') {
  const recPoints = reception === 'ppr' ? 1 : reception === 'half-ppr' ? 0.5 : 0;
  return {
    pass_yd: 0.04,
    pass_td: 4,
    pass_int: -1,
    pass_2pt: 2,
    rush_yd: 0.1,
    rush_td: 6,
    rush_2pt: 2,
    rec: recPoints,
    rec_yd: 0.1,
    rec_td: 6,
    rec_2pt: 2,
    fum_lost: -2,
    fgm: 3,
    xpm: 1,
    sack: 1,
    int: 2,
    fum_rec: 2,
    def_td: 6,
    def_kr_td: 6,
  };
}

interface PositionDef {
  key: string;
  label: string;
  badge: string;
  cls: string;
  min: number;
  max: number;
}

const POSITION_DEFS: PositionDef[] = [
  { key: 'qb', label: 'QB', badge: 'QB', cls: 'pos-qb', min: 1, max: 3 },
  { key: 'rb', label: 'RB', badge: 'RB', cls: 'pos-rb', min: 1, max: 5 },
  { key: 'wr', label: 'WR', badge: 'WR', cls: 'pos-wr', min: 1, max: 5 },
  { key: 'te', label: 'TE', badge: 'TE', cls: 'pos-te', min: 0, max: 3 },
  { key: 'flex', label: 'FLEX (W/R/T)', badge: 'FLEX', cls: 'pos-flex', min: 0, max: 4 },
  { key: 'k', label: 'K', badge: 'K', cls: 'pos-k', min: 0, max: 2 },
  { key: 'def', label: 'DEF', badge: 'DEF', cls: 'pos-def', min: 0, max: 2 },
  { key: 'd', label: 'D', badge: 'D', cls: 'pos-d', min: 0, max: 5 },
  { key: 's', label: 'S', badge: 'S', cls: 'pos-s', min: 0, max: 5 },
  { key: 'bn', label: 'BN (Bench)', badge: 'BN', cls: 'pos-bn', min: 1, max: 15 },
];

export interface YahooDraftSetupProps {
  onSubmit: (init: DraftInit) => void;
  onCancel: () => void;
}

export function YahooDraftSetup({ onSubmit, onCancel }: YahooDraftSetupProps) {
  const [name, setName] = useState<string>('Yahoo draft');
  const [teams, setTeams] = useState<number>(12);
  const [reception, setReception] = useState<'standard' | 'half-ppr' | 'ppr'>('half-ppr');
  const [mySlotInput, setMySlotInput] = useState<string>('1');

  const [counts, setCounts] = useState<Record<string, number>>({
    qb: 1,
    rb: 2,
    wr: 2,
    te: 1,
    flex: 1,
    k: 1,
    def: 1,
    d: 0,
    s: 0,
    bn: 6,
  });

  const qbCount = counts.qb ?? 1;
  const rbCount = counts.rb ?? 2;
  const wrCount = counts.wr ?? 2;
  const teCount = counts.te ?? 1;
  const flexCount = counts.flex ?? 1;
  const kCount = counts.k ?? 1;
  const defCount = counts.def ?? 1;
  const dCount = counts.d ?? 0;
  const sCount = counts.s ?? 0;
  const benchCount = counts.bn ?? 6;

  const startersCount = qbCount + rbCount + wrCount + teCount + flexCount + kCount + defCount;
  const rounds = startersCount + benchCount + dCount + sCount;

  const parsedMySlot = Number(mySlotInput);
  const mySlotValid = Number.isInteger(parsedMySlot) && parsedMySlot >= 1 && parsedMySlot <= teams;
  const canSubmit = name.trim().length > 0 && mySlotValid;

  function handleIncrement(key: string, max: number) {
    setCounts((prev) => {
      const current = prev[key] ?? 0;
      if (current >= max) return prev;
      return { ...prev, [key]: current + 1 };
    });
  }

  function handleDecrement(key: string, min: number) {
    setCounts((prev) => {
      const current = prev[key] ?? 0;
      if (current <= min) return prev;
      return { ...prev, [key]: current - 1 };
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const slotToTeam: Record<number, string> = {};
    const slotToTeamName: Record<number, string> = {};
    for (let slot = 1; slot <= teams; slot += 1) {
      slotToTeam[slot] = String(slot);
      slotToTeamName[slot] = `Team ${slot}`;
    }
    const startingSlots: RosterSlot[] = [
      ...Array.from({ length: qbCount }, () => 'QB' as RosterSlot),
      ...Array.from({ length: rbCount }, () => 'RB' as RosterSlot),
      ...Array.from({ length: wrCount }, () => 'WR' as RosterSlot),
      ...Array.from({ length: teCount }, () => 'TE' as RosterSlot),
      ...Array.from({ length: flexCount }, () => 'FLEX' as RosterSlot),
      ...Array.from({ length: kCount }, () => 'K' as RosterSlot),
      ...Array.from({ length: defCount }, () => 'DEF' as RosterSlot),
    ];
    const rosterSlots: Partial<Record<RosterSlot, number>> = {
      QB: qbCount,
      RB: rbCount,
      WR: wrCount,
      TE: teCount,
      ...(flexCount > 0 ? { FLEX: flexCount } : {}),
      ...(kCount > 0 ? { K: kCount } : {}),
      ...(defCount > 0 ? { DEF: defCount } : {}),
      BN: benchCount + dCount + sCount,
      IR: 1,
    };
    const init: DraftInit = {
      provider: 'yahoo',
      draftId: `yahoo-manual-${parsedMySlot}`,
      leagueId: 'yahoo-manual',
      draftType: 'snake',
      teams,
      rounds,
      slotToTeam,
      slotToTeamName,
      myTeamId: String(parsedMySlot),
      mySlot: parsedMySlot,
      settings: {
        provider: 'yahoo',
        leagueId: 'yahoo-manual',
        name: name.trim(),
        season: '2026',
        teams,
        startingSlots,
        rosterSlots,
        scoring: defaultYahooScoring(reception),
        format: { reception, qb: qbCount > 1 ? 'two-qb' : 'one-qb', draft: 'snake' },
      },
    };
    onSubmit(init);
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onCancel();
    }}>
      <section
        className="pick-dialog setup-dialog yahoo-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Set up Yahoo draft"
      >
        <header className="yahoo-setup-header">
          <div>
            <p className="eyebrow">Yahoo</p>
            <h2>Set up Yahoo draft</h2>
          </div>
          <button className="quiet-button" type="button" onClick={onCancel}>Close</button>
        </header>

        <form className="yahoo-setup-form" onSubmit={handleSubmit}>
          <div className="yahoo-setup-top-grid">
            <label className="yahoo-setup-label">
              League name
              <input
                className="yahoo-setup-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Friends League"
                required
              />
            </label>
            <label className="yahoo-setup-label">
              Teams
              <select className="yahoo-setup-select" value={teams} onChange={(e) => setTeams(Number(e.target.value))}>
                {YAHOO_TEAMS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="yahoo-setup-label">
              Scoring
              <select className="yahoo-setup-select" value={reception} onChange={(e) => setReception(e.target.value as typeof reception)}>
                {YAHOO_FORMATS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="yahoo-setup-label">
              Draft position
              <input
                className="yahoo-setup-input"
                type="number"
                min={1}
                max={teams}
                value={mySlotInput}
                onChange={(e) => setMySlotInput(e.target.value)}
                placeholder="e.g. 4"
                required
              />
            </label>
          </div>

          <div className="sleeper-roster-settings">
            <div className="sleeper-roster-header">
              <div>
                <h3 className="sleeper-roster-title">Roster Settings</h3>
                <p className="sleeper-roster-subtitle">Set roster positions</p>
                <div className="sleeper-title-bar" />
              </div>
              <div className="setup-rounds-pill" data-testid="yahoo-rounds-summary">
                <strong>Draft Rounds: {rounds}</strong>
                <span className="setup-rounds-sub">
                  ({startersCount} starters + {benchCount} bench{dCount > 0 ? ` + ${dCount} D` : ''}{sCount > 0 ? ` + ${sCount} S` : ''})
                </span>
              </div>
            </div>

            <div className="sleeper-slot-list" role="region" aria-label="Roster positions">
              {POSITION_DEFS.map((def) => {
                const count = counts[def.key] ?? 0;
                const rowsCount = count === 0 ? 1 : count;
                return Array.from({ length: rowsCount }, (_, i) => (
                  <div
                    key={`${def.key}-${i}`}
                    className={`sleeper-slot-row ${count === 0 ? 'sleeper-slot-inactive' : ''}`}
                    data-testid={`roster-slot-row-${def.key}`}
                  >
                    <div className="sleeper-slot-buttons">
                      <button
                        type="button"
                        className="sleeper-circle-btn"
                        onClick={() => handleIncrement(def.key, def.max)}
                        disabled={count >= def.max}
                        aria-label={`Increase ${def.label}`}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="sleeper-circle-btn"
                        onClick={() => handleDecrement(def.key, def.min)}
                        disabled={count <= def.min}
                        aria-label={`Decrease ${def.label}`}
                      >
                        −
                      </button>
                    </div>
                    <span className={`sleeper-slot-icon ${def.cls}`}>{def.badge}</span>
                    <span className="sleeper-slot-label">
                      {def.label}
                      {count === 0 ? ' (click + to add)' : ''}
                    </span>
                  </div>
                ));
              })}
            </div>
          </div>

          <footer className="dialog-actions">
            <button type="submit" disabled={!canSubmit}>Start draft</button>
            <button className="quiet-button" type="button" onClick={onCancel}>Cancel</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
