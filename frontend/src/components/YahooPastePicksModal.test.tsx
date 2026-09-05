import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DraftInit, PlayerMeta } from '../../../shared/types';
import type { PickOverride } from '../state/draftBoardState';
import { YahooPastePicksModal } from './YahooPastePicksModal';

const TEST_DRAFT_INIT: DraftInit = {
  provider: 'yahoo',
  draftId: 'test-yahoo-1',
  leagueId: 'yahoo-league-1',
  teams: 10,
  rounds: 18,
  draftType: 'snake',
  mySlot: 8,
  myTeamId: 'team-8',
  slotToTeam: { 1: 'team-1', 2: 'team-2', 8: 'team-8' },
  slotToTeamName: {},
  settings: {
    provider: 'yahoo',
    leagueId: 'yahoo-league-1',
    name: "Herbert's League",
    season: '2026',
    teams: 10,
    scoring: { rec: 1.0 },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF'],
    rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DEF: 1, BN: 8 },
  },
};

const SAMPLE_PLAYERS: PlayerMeta[] = [
  { playerId: 'p-gibbs', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', byeWeek: 6, age: 22, yearsExp: 1, injuryStatus: null, eligiblePositions: ['RB'], ids: {} },
  { playerId: 'p-bijan', name: 'Bijan Robinson', position: 'RB', team: 'ATL', byeWeek: 11, age: 22, yearsExp: 1, injuryStatus: null, eligiblePositions: ['RB'], ids: {} },
  { playerId: 'p-jsn', name: 'Jaxon Smith-Njigba', position: 'WR', team: 'SEA', byeWeek: 11, age: 22, yearsExp: 1, injuryStatus: null, eligiblePositions: ['WR'], ids: {} },
];

const RAW_FEED = `Nikolas LeBlanc
J. Gibbs

RB
Det
Bye 6
Scottie MackScottie Mack left
2
Gabe
B. Robinson

RB
Atl
Bye 11
8
You
J. Smith-Njigba

WR
Sea
Bye 11`;

describe('YahooPastePicksModal', () => {
  it('renders modal with title and empty textarea', () => {
    render(
      <YahooPastePicksModal
        draftInit={TEST_DRAFT_INIT}
        players={SAMPLE_PLAYERS}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Paste draft picks' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Apply/i })).toBeDisabled();
  });

  it('closes on Close / Cancel button or Escape key', () => {
    const onClose = vi.fn();
    render(
      <YahooPastePicksModal
        draftInit={TEST_DRAFT_INIT}
        players={SAMPLE_PLAYERS}
        onSubmit={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('parses pasted text, shows live preview, and submits overrides on Apply', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    render(
      <YahooPastePicksModal
        draftInit={TEST_DRAFT_INIT}
        players={SAMPLE_PLAYERS}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.paste(RAW_FEED);

    // Should recognize 3 picks
    expect(screen.getByText(/3 picks recognized/i)).toBeInTheDocument();
    expect(screen.getByText(/Seat detected: Slot 8 \(You\)/i)).toBeInTheDocument();

    const applyButton = screen.getByRole('button', { name: /Apply 3 picks/i });
    expect(applyButton).not.toBeDisabled();

    await user.click(applyButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [overrides, detectedSlot, slotToTeamName] = onSubmit.mock.calls[0] as [
      PickOverride[],
      number | null,
      Record<number, string>,
    ];

    expect(overrides).toHaveLength(3);
    const pick1 = overrides[0]!;
    const pick2 = overrides[1]!;
    const pick3 = overrides[2]!;

    expect(pick1.overall).toBe(1);
    expect(pick1.playerId).toBe('p-gibbs');
    expect(pick1.providerPlayerName).toBe('Jahmyr Gibbs');

    expect(pick2.overall).toBe(2);
    expect(pick2.playerId).toBe('p-bijan');

    expect(pick3.overall).toBe(8);
    expect(pick3.playerId).toBe('p-jsn');

    expect(detectedSlot).toBe(8);
    expect(slotToTeamName[1]).toBe('Nikolas LeBlanc');
    expect(slotToTeamName[2]).toBe('Gabe');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
