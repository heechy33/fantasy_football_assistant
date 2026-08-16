import { useEffect, useRef, useState } from 'react';

/** One entry in the session `⋯` menu — the only place session-management controls (log a pick,
 * edit setup, switch modes, reconnect, choose another draft) live. Owned by `App`, which knows
 * which handlers apply to the current session kind; this component only renders the list. */
export interface SessionAction {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** The `⋯` overflow trigger + popover menu, rendered next to the board's card/row toggle.
 * Dismisses on outside click or Escape; a scroll-locking modal (`useModalFocus`) would be the
 * wrong tool for an anchored popover this small. */
export function SessionMenu({ actions }: { actions: ReadonlyArray<SessionAction> }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="session-menu-wrap" ref={containerRef}>
      <button
        type="button"
        className="chrome-outline-button session-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Session actions"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="session-menu" role="menu" aria-label="Session actions">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className="session-menu-item"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
