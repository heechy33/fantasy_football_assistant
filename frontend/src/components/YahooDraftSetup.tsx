import { useState, type FormEvent } from 'react';
import type { DraftInit, RosterSlot } from '../../../shared/types';

const YAHOO_TEAMS_OPTIONS = [8, 10, 12, 14] as const;
const YAHOO_ROUNDS_OPTIONS = [12, 13, 14, 15, 16] as const;
const YAHOO_FORMATS: ReadonlyArray<{ value: 'standard' | 'half-ppr' | 'ppr'; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'half-ppr', label: 'Half-PPR' },
  { value: 'ppr', label: 'Full PPR' },
];
const YAHOO_QB_FORMATS: ReadonlyArray<{ value: 'one-qb' | 'superflex'; label: string }> = [
  { value: 'one-qb', label: '1QB' },
  { value: 'superflex', label: 'Superflex' },
];

/** The 9-slot starting lineup used by both the manual ESPN setup and the Yahoo create form. Kept
 * here as a self-contained constant so the Yahoo create form can synthesize its own LeagueSettings
 * without depending on ManualDraftSetup (which is the seat-edit dialog, not the create form). */
const YAHOO_STARTING_SLOTS: RosterSlot[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K'];
const YAHOO_ROSTER_SLOTS: Partial<Record<RosterSlot, number>> = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, BN: 5, IR: 1,
};

/** Yahoo's default half-PPR scoring (pass_yd 0.04, pass_td 4, rush_yd 0.1, rush_td 6, rec 0.5,
 * rec_yd 0.1, rec_td 6, fum_lost -2, fgm 3, xpm 1, sack 1, int 2, fum_rec 2, def_td 6). Standard
 * and full-PPR variants swap `rec: 0.5` to `0` and `1` respectively. Bonuses (TE premium, distance
 * tiers) are intentionally omitted — the existing MANUAL_SCORING_DIAGNOSTICS banner already
 * discloses the unmodeled gap for any league that isn't a vanilla 0.5 PPR Yahoo default. */
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

export interface YahooDraftSetupProps {
  /** Submit a complete `DraftInit`; the caller wraps this in a `kind: 'manual'` session with
   * `frozenInit.settings.provider === 'yahoo'`. */
  onSubmit: (init: DraftInit) => void;
  onCancel: () => void;
}

/**
 * The from-scratch Yahoo create form (2026-09-01, see DECISIONS.md). Distinct from
 * `ManualDraftSetup` (the seat-edit dialog) because the inputs here are the ones the manual-edit
 * dialog *can't* collect: teams, rounds, reception scoring, QB format, my seat. The session is
 * always `kind: 'manual'` (Yahoo has no live adapter yet); `frozenInit.settings.provider` is
 * `'yahoo'` so the draft-room disclosure banner and `adpBoardKeyFor`'s `'yahoo-half-ppr'` branch
 * can both find it.
 */
export function YahooDraftSetup({ onSubmit, onCancel }: YahooDraftSetupProps) {
  const [name, setName] = useState<string>('Yahoo draft');
  const [teams, setTeams] = useState<number>(12);
  const [rounds, setRounds] = useState<number>(15);
  const [reception, setReception] = useState<'standard' | 'half-ppr' | 'ppr'>('half-ppr');
  const [qb, setQb] = useState<'one-qb' | 'superflex'>('one-qb');
  const [mySlotInput, setMySlotInput] = useState<string>('1');

  const parsedMySlot = Number(mySlotInput);
  const mySlotValid = Number.isInteger(parsedMySlot) && parsedMySlot >= 1 && parsedMySlot <= teams;
  const canSubmit = name.trim().length > 0 && mySlotValid;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const slotToTeam: Record<number, string> = {};
    const slotToTeamName: Record<number, string> = {};
    for (let slot = 1; slot <= teams; slot += 1) {
      slotToTeam[slot] = String(slot);
      slotToTeamName[slot] = `Team ${slot}`;
    }
    const startingSlots: RosterSlot[] = qb === 'superflex'
      ? [...YAHOO_STARTING_SLOTS.slice(0, -2), 'SUPER_FLEX', ...YAHOO_STARTING_SLOTS.slice(-2)]
      : YAHOO_STARTING_SLOTS;
    const init: DraftInit = {
      provider: 'yahoo',
      // No league id to anchor against — fall back to a stable local handle for refresh-resume.
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
        rosterSlots: qb === 'superflex'
          ? { ...YAHOO_ROSTER_SLOTS, SUPER_FLEX: 1 }
          : YAHOO_ROSTER_SLOTS,
        scoring: defaultYahooScoring(reception),
        format: { reception, qb, draft: 'snake' },
      },
    };
    onSubmit(init);
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onCancel();
    }}>
      <section
        className="pick-dialog setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Set up Yahoo draft"
      >
        <header>
          <div>
            <p className="eyebrow">Yahoo</p>
            <h2>Set up Yahoo draft</h2>
          </div>
          <button className="quiet-button" type="button" onClick={onCancel}>Close</button>
        </header>
        <p className="muted setup-intro">
          No Yahoo login is needed. Sit in the Yahoo draft room and click a player for every pick;
          the rest of the app runs on the half-PPR preset that matches Yahoo&apos;s default scoring.
        </p>
        <form className="setup-form" onSubmit={handleSubmit}>
          <label className="setup-field-wide">
            League name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Friends League"
              required
            />
          </label>
          <label>
            Teams
            <select value={teams} onChange={(e) => setTeams(Number(e.target.value))}>
              {YAHOO_TEAMS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Rounds
            <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
              {YAHOO_ROUNDS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Scoring
            <select value={reception} onChange={(e) => setReception(e.target.value as typeof reception)}>
              {YAHOO_FORMATS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            QB format
            <select value={qb} onChange={(e) => setQb(e.target.value as typeof qb)}>
              {YAHOO_QB_FORMATS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Your draft position (1–{teams})
            <input
              type="number"
              min={1}
              max={teams}
              value={mySlotInput}
              onChange={(e) => setMySlotInput(e.target.value)}
              placeholder="e.g. 4"
              required
            />
          </label>
          <p className="setup-field-wide setup-hint">
            On Yahoo this is your position in the snake order — not your team name. The app derives
            every round/slot/team for each click from this seat and the team count.
          </p>
          <p className="setup-field-wide setup-hint" data-testid="yahoo-preset-disclosure">
            Scoring preset applied — custom league bonuses (TE premium, distance/yardage tiers, return
            bonuses) are not represented in the projection data and are not modeled.
          </p>
          <footer className="dialog-actions">
            <button type="submit" disabled={!canSubmit}>Start draft</button>
            <button className="quiet-button" type="button" onClick={onCancel}>Cancel</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
