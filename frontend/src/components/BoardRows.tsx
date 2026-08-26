import type { ReactNode } from 'react';

export interface BoardRowsProps {
  children: ReactNode;
  itemCount: number;
  id?: string;
  label: string;
}

/** Card-styled, continuous scanning list. The full capped result set is rendered at once. */
export function BoardRows({ children, itemCount, id = 'recommendation-board', label }: BoardRowsProps) {
  return (
    <section className="board-rows" id={id} role="region" aria-label={label}>
      <div className="board-rows-header">
        <span>Player</span><span>Role</span><span>Proj</span><span>ADP</span><span>Usage</span><span>Avail</span>
      </div>
      <div className="board-rows-list">{children}</div>
      <span className="visually-hidden" aria-live="polite">Showing {itemCount} players</span>
    </section>
  );
}
