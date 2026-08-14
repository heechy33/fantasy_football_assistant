/**
 * Teams page — nav shell plus an explicit empty state. Real rosters and team
 * management land in a later phase; this establishes the destination so the
 * shell (nav + page routing) is complete without inventing fake roster UI.
 */
export function TeamsPage() {
  return (
    <section className="teams-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Teams</p>
          <h2>Your teams</h2>
        </div>
      </div>
      <p className="teams-empty-copy">
        Rosters and team management arrive in a later phase. For now, connect to a
        live Sleeper draft from the Home page and track it in the Draft Room.
      </p>
    </section>
  );
}
