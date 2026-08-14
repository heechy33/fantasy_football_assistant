import type { ReactNode } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';

interface DrawerProps {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider panel for player-detail content; log/team keep the default rail width. */
  size?: 'default' | 'wide';
}

/** Accessible slide-over for the narrow-viewport log/team rails and for player details. */
export function Drawer({ open, label, onClose, children, size = 'default' }: DrawerProps) {
  const panelRef = useModalFocus<HTMLDivElement>(onClose, open);
  if (!open) return null;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <div
        ref={panelRef}
        className="drawer-panel"
        data-size={size === 'wide' ? 'wide' : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div className="drawer-header">
          <strong>{label}</strong>
          <button className="quiet-button" type="button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
