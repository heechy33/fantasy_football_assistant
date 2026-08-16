import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionMenu, type SessionAction } from './SessionMenu';

describe('SessionMenu', () => {
  it('opens the menu, fires the selected action, and closes on selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const actions: SessionAction[] = [
      { id: 'log', label: 'Log next pick', onSelect },
      { id: 'edit', label: 'Edit draft setup', onSelect: () => undefined, disabled: true },
    ];
    render(<SessionMenu actions={actions} />);

    const trigger = screen.getByRole('button', { name: 'Session actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const item = screen.getByRole('menuitem', { name: 'Log next pick' });
    expect(screen.getByRole('menuitem', { name: 'Edit draft setup' })).toBeDisabled();

    await user.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the menu on Escape', async () => {
    const user = userEvent.setup();
    const actions: SessionAction[] = [{ id: 'log', label: 'Log next pick', onSelect: () => undefined }];
    render(<SessionMenu actions={actions} />);

    await user.click(screen.getByRole('button', { name: 'Session actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the menu on an outside click', async () => {
    const user = userEvent.setup();
    const actions: SessionAction[] = [{ id: 'log', label: 'Log next pick', onSelect: () => undefined }];
    render(
      <div>
        <button type="button">Outside</button>
        <SessionMenu actions={actions} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Session actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
