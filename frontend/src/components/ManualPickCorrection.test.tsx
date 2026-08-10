import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ManualPickCorrection } from './ManualPickCorrection';

describe('ManualPickCorrection accessibility', () => {
  it('closes on Escape and moves initial focus into the dialog (previously had neither)', () => {
    const onClose = vi.fn();
    render(
      <ManualPickCorrection
        mode="correct-existing"
        overall={5}
        rankedPlayers={[]}
        unavailablePlayerIds={new Set()}
        onSubmit={vi.fn()}
        onUndo={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
