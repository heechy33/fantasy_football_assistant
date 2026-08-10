import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './Drawer';

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<Drawer open={false} label="Draft log" onClose={vi.fn()}><p>content</p></Drawer>);
    expect(container).toBeEmptyDOMElement();
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
    const { container, rerender } = render(<Drawer open label="Draft log" onClose={onClose}><p>content</p></Drawer>);

    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(container.querySelector('.drawer-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<Drawer open label="Draft log" onClose={onClose}><p>content</p></Drawer>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
