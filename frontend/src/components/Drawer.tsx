import type { ReactNode } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';

interface DrawerProps {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** Accessible slide-over used only in the narrow-viewport layout — see `DraftWorkspace`'s
 * `useMediaQuery` gate. Only mounted while narrow, so the focus trap only ever engages on mobile. */
export function Drawer({ open, label, onClose, children }: DrawerProps) {
  const panelRef = useModalFocus<HTMLDivElement>(onClose, open);
  if (!open) return null;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <div ref={panelRef} className="drawer-panel" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <div className="drawer-header">
          <strong>{label}</strong>
          <button className="quiet-button" type="button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
