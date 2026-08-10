import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerMeta } from '../../../shared/types';
import type { Recommendation } from '../engine/recommend';
import { PlayerContextModal } from './PlayerContextModal';

const player: PlayerMeta = {
  playerId: 'rb1', name: 'Rush One', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
};

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open && <PlayerContextModal player={player} usage={undefined} feedStatus="ready" onClose={() => setOpen(false)} />}
    </div>
  );
}

describe('PlayerContextModal accessibility', () => {
  it('moves focus into the dialog on open and restores it to the invoking control on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const openButton = screen.getByRole('button', { name: 'Open' });
    openButton.focus();

    await user.click(openButton);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(openButton);
    expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(openButton);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<PlayerContextModal player={player} usage={undefined} feedStatus="ready" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus inside the dialog (wraps from last to first and Shift+Tab the other way)', () => {
    render(<PlayerContextModal player={player} usage={undefined} feedStatus="ready" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    expect(focusable.length).toBeGreaterThanOrEqual(1);
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes when the backdrop (not the dialog panel) is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<PlayerContextModal player={player} usage={undefined} feedStatus="ready" onClose={onClose} />);
    fireEvent.mouseDown(container.querySelector('.dialog-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the dialog panel', () => {
    const onClose = vi.fn();
    render(<PlayerContextModal player={player} usage={undefined} feedStatus="ready" onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the engine explanation and FFC disclosure when a recommendation is supplied', () => {
    const recommendation: Recommendation = {
      playerId: 'rb1', rank: 1, projectedPoints: 100, marginalRosterValue: 10, replacementAdjustedValue: 15,
      replacementLevelPoints: 50, vor: 15, vona: null, deprioritized: false, tier: 1, tierGapAfter: 0,
      tierBoundaryGap: 0, tierUrgency: 0, availableNextPickProbability: 0.5, availabilityAdp: 5,
      availabilityAdpHigh: 3, availabilityAdpLow: 8, availabilityStdev: 1, availabilitySampleSize: 250,
      nearTieWithLeader: false, scoringDiagnosticSeverity: 'none', missingScoringKeys: [], confidence: 'high',
      assignedRosterSlot: 'RB', replacementPlayerId: null, reasons: ['Test reason.'], warnings: [],
    };
    render(
      <PlayerContextModal
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={recommendation}
        adpDisclosure={{ source: 'ffc-fallback', mockDrafts: 5000, teams: 12, format: 'ppr' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Engine explanation')).toBeInTheDocument();
    expect(screen.getByText('Test reason.')).toBeInTheDocument();
    expect(screen.getByText(/5,000 recorded/)).toBeInTheDocument();
  });

  it('discloses Sleeper as the source (not FFC mock-draft population) when Sleeper is canonical', () => {
    const recommendation: Recommendation = {
      playerId: 'rb1', rank: 1, projectedPoints: 100, marginalRosterValue: 10, replacementAdjustedValue: 15,
      replacementLevelPoints: 50, vor: 15, vona: null, deprioritized: false, tier: 1, tierGapAfter: 0,
      tierBoundaryGap: 0, tierUrgency: 0, availableNextPickProbability: 0.5, availabilityAdp: 5,
      availabilityAdpHigh: null, availabilityAdpLow: null, availabilityStdev: 1, availabilitySampleSize: null,
      nearTieWithLeader: false, scoringDiagnosticSeverity: 'none', missingScoringKeys: [], confidence: 'high',
      assignedRosterSlot: 'RB', replacementPlayerId: null, reasons: ['Test reason.'], warnings: [],
    };
    render(
      <PlayerContextModal
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={recommendation}
        adpDisclosure={{ source: 'sleeper', format: 'ppr' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Availability model (Sleeper draft-lobby ADP)')).toBeInTheDocument();
    expect(screen.getByText(/Sourced from Sleeper's own draft-lobby ADP/)).toBeInTheDocument();
    expect(screen.getByText(/fitted estimate calibrated against Fantasy Football Calculator/)).toBeInTheDocument();
    expect(screen.queryByText(/recorded.*Fantasy Football Calculator mock drafts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/treat the range and sample size above as approximate/)).not.toBeInTheDocument();
    // Range/sample-size render as n/a since Sleeper's lobby exposes neither.
    expect(screen.getAllByText(/n\/a/).length).toBeGreaterThanOrEqual(2);
  });
});
