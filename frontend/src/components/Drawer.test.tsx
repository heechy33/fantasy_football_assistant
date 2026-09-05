import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './Drawer';

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<Drawer open={false} label="Draft log" onClose={vi.fn()}><p>content</p></Drawer>);
    expect(container).toBeEmptyDOMElement();
  });

  it('portals the open backdrop to document.body so it escapes workspace stacking contexts', () => {
    // Workspace columns carry `z-index` (App.css `.workspace-column`), which creates a stacking
    // context that would trap a fixed backdrop rendered inline and let a sibling rail paint on
    // top of the open drawer — the portaled backdrop must live outside the render tree.
    const { container } = render(<Drawer open label="Draft log" onClose={vi.fn()}><p>content</p></Drawer>);
    const backdrop = document.body.querySelector('.drawer-backdrop');
    expect(backdrop).not.toBeNull();
    expect(container.contains(backdrop)).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Draft log' })).toBeInTheDocument();
  });

  it('renders labeled dialog content and moves initial focus into the dialog when open', () => {
    render(<Drawer open label="Draft log" onClose={vi.fn()}><button type="button">Inside</button></Drawer>);
    const dialog = screen.getByRole('dialog', { name: 'Draft log' });
    expect(dialog).toBeInTheDocument();
    // The header's Close button precedes the drawer content in DOM order, so it — not the content's
    // own first control — is the dialog's first focusable element and gets initial focus.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and on backdrop click, not on panel click', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Drawer open label="Draft log" onClose={onClose}><p>content</p></Drawer>);

    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('dialog').closest('.drawer-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<Drawer open label="Draft log" onClose={onClose}><p>content</p></Drawer>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks a wide drawer with data-size="wide"', () => {
    render(<Drawer open size="wide" label="Rush One context" onClose={vi.fn()}><p>content</p></Drawer>);
    expect(screen.getByRole('dialog', { name: 'Rush One context' })).toHaveAttribute('data-size', 'wide');
  });

  it('applies team and custom className to the dialog element', () => {
    render(
      <Drawer open label="Rush One" team="BUF" className="player-detail-drawer" onClose={vi.fn()}>
        <p>content</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Rush One' });
    expect(dialog).toHaveAttribute('data-team', 'BUF');
    expect(dialog).toHaveClass('drawer-panel', 'player-detail-drawer');
  });
});
