import { useState, type FormEvent } from 'react';
import type { DraftInit, LeagueFormat, LeagueSettings, RosterSlot } from '../../../shared/types';
import { DEFAULT_MOCK_SCORING } from '../adapters/sleeper';

export const MANUAL_DRAFT_SEASON = '2026';
export const MANUAL_DRAFT_ID = 'manual-session';

/** Target ESPN league config (see espn_provider_chrome_extension_2026-08-14.plan.md). */
export const TARGET_STARTING_SLOTS: RosterSlot[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K'];
export const TARGET_ROSTER_SLOTS: Partial<Record<RosterSlot, number>> = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, BN: 5, IR: 1 };
export const TARGET_FORMAT: LeagueFormat = { reception: 'ppr', qb: 'one-qb', draft: 'snake' };

/** Honest draft-day diagnostic: the league's custom PPR bonuses are not modeled by the projections. */
export const MANUAL_SCORING_DIAGNOSTICS = [
  'PPR preset applied — custom league bonuses (distance/yardage tiers, return bonuses, D/ST tiers) are not represented in the projection data and are not modeled.',
];

export interface ManualDraftSetupValues {
  leagueName: string;
  teams: number;
  rounds: number;
  mySlot: number;
}

/**
 * Pure construction of a complete, valid DraftInit from the form values. Team identity is
 * synthesized as slot-number identity (slot N -> "N"), which is all the snake order math needs;
 * `myTeamId` is `slotToTeam[mySlot]`, so it is non-null whenever mySlot is valid (the form enforces
 * `1 <= mySlot <= teams`, which keeps `boardKind` off the 'no-seat' path).
 */
export function buildManualDraftInit(values: ManualDraftSetupValues): DraftInit {
  const leagueName = values.leagueName.trim() || 'Manual draft';
  const slotToTeam: Record<number, string> = {};
  const slotToTeamName: Record<number, string> = {};
  for (let slot = 1; slot <= values.teams; slot += 1) {
    slotToTeam[slot] = String(slot);
    slotToTeamName[slot] = `Team ${slot}`;
  }
  const settings: LeagueSettings = {
    provider: 'manual',
    leagueId: MANUAL_DRAFT_ID,
    name: leagueName,
    season: MANUAL_DRAFT_SEASON,
    teams: values.teams,
    startingSlots: TARGET_STARTING_SLOTS,
    rosterSlots: TARGET_ROSTER_SLOTS,
    scoring: DEFAULT_MOCK_SCORING.ppr,
    format: TARGET_FORMAT,
  };
  return {
    provider: 'manual',
    draftId: MANUAL_DRAFT_ID,
    leagueId: MANUAL_DRAFT_ID,
    draftType: 'snake',
    teams: values.teams,
    rounds: values.rounds,
    slotToTeam,
    slotToTeamName,
    myTeamId: slotToTeam[values.mySlot] ?? null,
    mySlot: values.mySlot,
    settings,
  };
}
export interface ManualDraftSetupProps {
  /** Existing DraftInit when setup is reopened to correct mySlot mid-draft (edit mode). */
  initial?: DraftInit | null;
  onSubmit: (init: DraftInit) => void;
  onCancel: () => void;
}

/** The confirmed happy path is confirm-and-go: the league config is prefilled and only mySlot must
 * be entered (it is not known until the ~6:00 PM order reveal). */
export function ManualDraftSetup({ initial, onSubmit, onCancel }: ManualDraftSetupProps) {
  const [leagueName, setLeagueName] = useState(initial?.settings.name ?? 'ESPN draft — LeAgUe');
  const [teamsInput, setTeamsInput] = useState(String(initial?.teams ?? 10));
  const [roundsInput, setRoundsInput] = useState(String(initial?.rounds ?? 14));
  const [mySlotInput, setMySlotInput] = useState(initial?.mySlot != null ? String(initial.mySlot) : '');

  const teams = Number(teamsInput);
  const rounds = Number(roundsInput);
  const mySlot = Number(mySlotInput);
  const teamsValid = Number.isInteger(teams) && teams >= 2;
  const roundsValid = Number.isInteger(rounds) && rounds >= 1;
  const mySlotValid = Number.isInteger(mySlot) && mySlot >= 1 && mySlot <= teams;
  const canSubmit = teamsValid && roundsValid && mySlotValid;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(buildManualDraftInit({ leagueName, teams, rounds, mySlot }));
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onCancel();
    }}>
      <section
        className="pick-dialog setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? 'Edit draft setup' : 'Manual draft setup'}
      >
        <header>
          <div>
            <p className="eyebrow">Offline mode</p>
            <h2>{initial ? 'Edit draft setup' : 'Set up the manual draft'}</h2>
          </div>
          <button className="quiet-button" type="button" onClick={onCancel}>Close</button>
        </header>
        <p className="muted setup-intro">
          Build the draft the app will track. Settings are prefilled for the ESPN league — fill in your
          draft slot once the order is revealed (~6:00 PM), then start logging picks. Your slot can be
          corrected later without losing picks.
        </p>
        <form className="setup-form" onSubmit={handleSubmit}>
          <label className="setup-field-wide">
            League name
            <input value={leagueName} onChange={(e) => setLeagueName(e.target.value)} placeholder="League name" />
          </label>
          <label>
            Teams
            <input type="number" min={2} value={teamsInput} onChange={(e) => setTeamsInput(e.target.value)} required />
          </label>
          <label>
            Rounds
            <input type="number" min={1} value={roundsInput} onChange={(e) => setRoundsInput(e.target.value)} required />
          </label>
          <label>
            My draft slot
            <input
              type="number"
              min={1}
              max={teamsValid ? teams : undefined}
              value={mySlotInput}
              onChange={(e) => setMySlotInput(e.target.value)}
              placeholder="e.g. 2"
              required
            />
          </label>
          <p className="setup-field-wide setup-hint">
            Snake · 9 starters: QB · RB · RB · WR · WR · TE · FLEX · DEF · K · PPR scoring · 5 bench + 1 IR.
          </p>
          <div className="setup-diagnostic" role="note">
            <strong>Scoring diagnostic:</strong> {MANUAL_SCORING_DIAGNOSTICS[0]}
          </div>
          <footer className="dialog-actions">
            <button type="submit" disabled={!canSubmit}>{initial ? 'Save setup' : 'Start draft'}</button>
            <button className="quiet-button" type="button" onClick={onCancel}>Cancel</button>
          </footer>
        </form>
      </section>
    </div>
  );
}


