import { useState, type FormEvent } from 'react';
import type { DraftInit, LeagueFormat, LeagueSettings, RosterSlot, SavedLeague } from '../../../shared/types';

export const MANUAL_DRAFT_ID = 'manual-session';

/** Target ESPN league config (see espn_provider_chrome_extension_2026-08-14.plan.md). Kept here
 * because guideLeagueSettings.ts builds its preview settings from the same shape. */
export const TARGET_STARTING_SLOTS: RosterSlot[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K'];
export const TARGET_ROSTER_SLOTS: Partial<Record<RosterSlot, number>> = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, BN: 5, IR: 1 };
export const TARGET_FORMAT: LeagueFormat = { reception: 'ppr', qb: 'one-qb', draft: 'snake' };

/** Honest draft-day diagnostic for MANUAL sessions only — a Sleeper takeover plays on with no
 * live scoring layer, so the PPR preset's unmodeled bonuses must be disclosed. ESPN bridge
 * sessions carry their league's REAL scoring map and disclose bonuses via the connect card's
 * structured bonus tags instead — this preset claim must never render for them. */
export const MANUAL_SCORING_DIAGNOSTICS = [
  'PPR preset applied — custom league bonuses (distance/yardage tiers, return bonuses, D/ST tiers) are not represented in the projection data and are not modeled.',
];

export interface ManualDraftSetupProps {
  /** The active session's DraftInit — every league field renders read-only from it. */
  initial: DraftInit;
  onSubmit: (init: DraftInit) => void;
  onCancel: () => void;
}

/**
 * Build a bridge-session DraftInit from a SAVED ESPN league (the Draft Room launcher path) instead
 * of the TARGET_* constants — the connect surface's whole job is to make re-typing league details
 * unnecessary (see the connect/start split, DECISIONS.md 2026-08-27). This is a REAL ESPN league:
 * both `init.leagueId` and `settings.leagueId` must carry the saved league's real
 * `providerLeagueId` (draft sync upserts leagues keyed off `effectiveInit.leagueId`/`settings` —
 * leaving `'manual-session'` in either would re-collapse every ESPN draft onto one row), and
 * `provider` is `'espn'` so retention and `latestDraftId` handling treat it as a bridge draft.
 * Team identity stays slot-number identity: the snake order math needs nothing more, and the
 * live stream's own order (espnDraftOrder) refines display names at draft time.
 */
export function buildEspnDraftInit(league: SavedLeague, mySlot: number): DraftInit {
  const slotToTeam: Record<number, string> = {};
  const slotToTeamName: Record<number, string> = {};
  for (let slot = 1; slot <= league.teams; slot += 1) {
    slotToTeam[slot] = String(slot);
    slotToTeamName[slot] = `Team ${slot}`;
  }
  const leagueId = league.providerLeagueId ?? league.settings.leagueId;
  const settings: LeagueSettings = { ...league.settings, provider: 'espn', leagueId };
  return {
    provider: 'espn',
    // League-scoped, NOT the shared MANUAL_DRAFT_ID (2026-08-28): every ESPN bridge session used to
    // get the same literal draftId, so draftSync's reconcile (which matches on provider+draftId
    // across ALL leagues) would find league A's stored draft while starting league B's session,
    // apply league A's overrides onto league B's board, and then overwrite league A's transcript
    // with league B's picks. MANUAL_DRAFT_ID stays exported for a genuine no-league manual session.
    draftId: `espn-${leagueId}`,
    leagueId,
    draftType: league.settings.format.draft === 'auction' ? 'auction' : 'snake',
    teams: league.teams,
    rounds: league.rounds,
    slotToTeam,
    slotToTeamName,
    myTeamId: slotToTeam[mySlot] ?? null,
    mySlot,
    settings,
  };
}

/**
 * The setup dialog, EDIT-ONLY as of 2026-08-28 (DECISIONS.md): drafts are started exclusively
 * through the live paths (Sleeper connect / ESPN launcher card, which auto-detects the seat via
 * JOINED/TOKEN), so there is no create form left to fake league config. This dialog exists for
 * one job — correcting the seat (mySlot) mid-draft after the order reveal or a seat-mismatch
 * warning. Every league field is read-only, and the submit PRESERVES the session's own settings
 * (provider/leagueId/scoring) rather than rebuilding them — the old form-based edit used to
 * overwrite an ESPN bridge session's scoring map with the PPR preset.
 */
export function ManualDraftSetup({ initial, onSubmit, onCancel }: ManualDraftSetupProps) {
  const [mySlotInput, setMySlotInput] = useState(initial.mySlot != null ? String(initial.mySlot) : '');

  const mySlot = Number(mySlotInput);
  const mySlotValid = Number.isInteger(mySlot) && mySlot >= 1 && mySlot <= initial.teams;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!mySlotValid) return;
    onSubmit({
      ...initial,
      mySlot,
      myTeamId: initial.slotToTeam[mySlot] ?? initial.myTeamId,
    });
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onCancel();
    }}>
      <section
        className="pick-dialog setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit draft setup"
      >
        <header>
          <div>
            <p className="eyebrow">{initial.settings.name || 'Draft'}</p>
            <h2>Edit draft setup</h2>
          </div>
          <button className="quiet-button" type="button" onClick={onCancel}>Close</button>
        </header>
        <p className="muted setup-intro">
          League settings are read from your connected league and cannot be edited here — only your
          draft position can be corrected. Picks already logged stay put.
        </p>
        <form className="setup-form" onSubmit={handleSubmit}>
          <label className="setup-field-wide">
            League name
            <input value={initial.settings.name} readOnly />
          </label>
          <label>
            Teams
            <input type="number" value={initial.teams} readOnly />
          </label>
          <label>
            Rounds
            <input type="number" value={initial.rounds} readOnly />
          </label>
          <label>
            Your draft position (1–{initial.teams})
            <input
              type="number"
              min={1}
              max={initial.teams}
              value={mySlotInput}
              onChange={(e) => setMySlotInput(e.target.value)}
              placeholder="e.g. 2"
              required
            />
          </label>
          <p className="setup-field-wide setup-hint">
            On ESPN this is your position in the snake order — not your team number. The app
            cross-checks it against the live order and warns on a mismatch.
          </p>
          {/* No scoring diagnostic here: bridge sessions carry the saved league's REAL scoring
              map (not the PPR preset), and its unmodeled bonuses were already disclosed as tags
              on the connect confirm card — repeating a preset claim here would be false. */}
          <footer className="dialog-actions">
            <button type="submit" disabled={!mySlotValid}>Save setup</button>
            <button className="quiet-button" type="button" onClick={onCancel}>Cancel</button>
          </footer>
        </form>
      </section>
    </div>
  );
}


