import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';

interface DrawerProps {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider panel for player-detail content; log/team keep the default rail width. */
  size?: 'default' | 'wide';
  team?: string | null;
  className?: string;
}

/**
 * Accessible slide-over for the narrow-viewport log/team rails and for player details.
 *
 * The backdrop is portaled to `document.body`: drawers render inside workspace columns whose
 * `z-index` (App.css `.workspace-column`) creates a stacking context, which would trap the
 * fixed-position backdrop at that column's level and let a sibling rail paint on top of the
 * open drawer. Portaling escapes every ancestor stacking context, so `z-index: 12` competes
 * at the root level as intended.
 */
export function Drawer({ open, label, onClose, children, size = 'default', team, className }: DrawerProps) {
  const panelRef = useModalFocus<HTMLDivElement>(onClose, open);
  if (!open) return null;
  return createPortal(
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <div
        ref={panelRef}
        className={`drawer-panel${className ? ` ${className}` : ''}`}
        data-size={size === 'wide' ? 'wide' : undefined}
        data-team={team ? team.toUpperCase() : undefined}
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
    </div>,
    document.body,
  );
}
