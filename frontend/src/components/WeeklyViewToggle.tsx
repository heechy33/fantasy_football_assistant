export type WeeklyView = 'graph' | 'table';

export interface WeeklyViewToggleProps {
  view: WeeklyView;
  onChange: (view: WeeklyView) => void;
}

/** Graph/Table button group for the Weekly tab. Same tab pattern as the detail
 * tabs: `role="tab"` + `aria-selected` + `.active`. */
export function WeeklyViewToggle({ view, onChange }: WeeklyViewToggleProps) {
  return (
    <div className="weekly-view-toggle" role="tablist" aria-label="Weekly view">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'graph'}
        className={view === 'graph' ? 'active' : undefined}
        onClick={() => onChange('graph')}
      >
        Graph
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'table'}
        className={view === 'table' ? 'active' : undefined}
        onClick={() => onChange('table')}
      >
        Table
      </button>
    </div>
  );
}
