export interface SessionAlert {
  id: string;
  message: string;
  action?: { label: string; onSelect: () => void };
  /** 'danger' for the seat-mismatch guard (would have caught the 2026-08-15 rehearsal bug live);
   * 'warn' for extension/tab/desync signals. Both are honest-failure surfaces, never silently
   * fixed — see the ESPN bridge status derivation in App.tsx. */
  severity?: 'warn' | 'danger';
}

export interface SessionAlertsProps {
  alerts: ReadonlyArray<SessionAlert>;
}

/**
 * Full-width strip directly under the top bar, replacing the old "ESPN bridge" chrome slab as the
 * home for the honest-failure signals that section used to carry (extension not detected, no ESPN
 * tab, stale/disconnected heartbeat, seat mismatch, stream desync). Renders nothing when healthy —
 * the pill in TopNav's live row covers the happy path — so this is only ever on screen when
 * something needs the user's attention.
 */
export function SessionAlerts({ alerts }: SessionAlertsProps) {
  if (alerts.length === 0) return null;
  return (
    <div className="session-alerts">
      {alerts.map((alert) => (
        <p key={alert.id} className="session-alert" data-severity={alert.severity ?? 'warn'} role="alert">
          <span>{alert.message}</span>
          {alert.action && (
            <button type="button" className="quiet-button" onClick={alert.action.onSelect}>
              {alert.action.label}
            </button>
          )}
        </p>
      ))}
    </div>
  );
}
