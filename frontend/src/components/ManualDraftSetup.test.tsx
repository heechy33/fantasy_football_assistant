import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SavedLeague } from '../../../shared/types';
import { buildEspnDraftInit, ManualDraftSetup } from './ManualDraftSetup';

/** A saved ESPN league fixture — the launcher path's input. The manual-create path (and
 * `buildManualDraftInit`) no longer exists; drafts start only from saved leagues. */
function savedLeague(overrides: Partial<SavedLeague> = {}): SavedLeague {
  return {
    id: 'doc-1',
    userId: 'user-1',
    provider: 'espn',
    providerLeagueId: 'espn-1',
    name: 'ESPN League',
    season: '2026',
    teams: 10,
    rounds: 14,
    mySlot: null,
    settings: {
      provider: 'espn',
      leagueId: 'espn-1',
      name: 'ESPN League',
      season: '2026',
      teams: 10,
      startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K'],
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, BN: 5, IR: 1 },
      scoring: { rec: 1, pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6 },
      format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    },
    providerUserId: null,
    latestDraftId: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('buildEspnDraftInit', () => {
  it('constructs a complete DraftInit with identity slot mapping and a real seat', () => {
    const init = buildEspnDraftInit(savedLeague(), 2);

    expect(init.provider).toBe('espn');
    // League-scoped (2026-08-28), not the shared MANUAL_DRAFT_ID -- see buildEspnDraftInit's doc.
    expect(init.draftId).toBe('espn-espn-1');
    expect(init.draftType).toBe('snake');
    expect(init.leagueId).toBe('espn-1');
    expect(init.settings.leagueId).toBe('espn-1');
    expect(init.teams).toBe(10);
    expect(init.rounds).toBe(14);
    expect(init.slotToTeam[1]).toBe('1');
    expect(init.slotToTeam[10]).toBe('10');
    expect(Object.keys(init.slotToTeam)).toHaveLength(10);
    expect(init.slotToTeamName?.[3]).toBe('Team 3');
    // The seat is what drives boardKind off the 'no-seat' path — must be non-null.
    expect(init.myTeamId).toBe('2');
    expect(init.mySlot).toBe(2);
    // The saved league's OWN scoring map travels through — never a preset rebuild.
    const league = savedLeague();
    expect(buildEspnDraftInit(league, 2).settings.scoring).toBe(league.settings.scoring);
  });

  it('maps any valid slot to its identity team id (the edit-mySlot invariant)', () => {
    const init = buildEspnDraftInit(savedLeague(), 10);
    expect(init.myTeamId).toBe('10');
  });
});

describe('ManualDraftSetup (edit-only)', () => {
  it('renders league fields read-only and corrects only the seat, preserving the session init', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = buildEspnDraftInit(savedLeague(), 5);
    render(<ManualDraftSetup initial={initial} onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/Your draft position/)).toHaveValue(5);
    // League fields are read-only: ESPN-connect is the only way a draft starts, so there is
    // nothing to hand-type here.
    expect(screen.getByLabelText('League name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Teams')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Rounds')).toHaveAttribute('readonly');

    await user.clear(screen.getByLabelText(/Your draft position/));
    await user.type(screen.getByLabelText(/Your draft position/), '7');
    await user.click(screen.getByRole('button', { name: 'Save setup' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const init = onSubmit.mock.calls[0]?.[0];
    expect(init.mySlot).toBe(7);
    expect(init.myTeamId).toBe('7');
    // The ESPN session's identity and scoring must survive an edit untouched.
    expect(init.leagueId).toBe('espn-1');
    expect(init.provider).toBe('espn');
    expect(init.settings.scoring).toBe(initial.settings.scoring);
  });

  it('rejects a slot outside the team count', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = buildEspnDraftInit(savedLeague(), 5);
    render(<ManualDraftSetup initial={initial} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const submit = screen.getByRole('button', { name: 'Save setup' });
    await user.clear(screen.getByLabelText(/Your draft position/));
    await user.type(screen.getByLabelText(/Your draft position/), '11'); // 10-team league
    expect(submit).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
