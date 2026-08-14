import { Children, useEffect, useState, type CSSProperties, type ReactNode } from 'react';

export interface BoardFilmstripProps {
  children: ReactNode;
  itemCount: number;
  cardsPerPage: number;
  canLoadMore: boolean;
  onLoadMore: () => void;
  id?: string;
  label: string;
  resetKey?: string;
}

export function getPageCount(itemCount: number, cardsPerPage: number): number {
  const safeItemCount = Math.max(0, itemCount);
  const safeCardsPerPage = Math.max(1, cardsPerPage);
  return Math.max(1, Math.ceil(safeItemCount / safeCardsPerPage));
}

export function clampPageIndex(pageIndex: number, pageCount: number): number {
  const lastPage = Math.max(0, pageCount - 1);
  return Math.min(Math.max(0, pageIndex), lastPage);
}

function pageLabel(pageIndex: number, itemCount: number, cardsPerPage: number): string {
  if (itemCount === 0) return 'Showing 0 of 0';
  const start = pageIndex * cardsPerPage + 1;
  const end = Math.min((pageIndex + 1) * cardsPerPage, itemCount);
  return `Showing ${start}–${end} of ${itemCount}`;
}

export function BoardFilmstrip({
  children,
  itemCount,
  cardsPerPage,
  canLoadMore,
  onLoadMore,
  id = 'recommendation-cards',
  label,
  resetKey,
}: BoardFilmstripProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = getPageCount(itemCount, cardsPerPage);
  const currentPage = clampPageIndex(pageIndex, pageCount);
  const childItems = Children.toArray(children);
  const pages: ReactNode[][] = [];
  for (let index = 0; index < childItems.length; index += Math.max(1, cardsPerPage)) {
    pages.push(childItems.slice(index, index + Math.max(1, cardsPerPage)));
  }

  useEffect(() => {
    setPageIndex(0);
  }, [resetKey]);

  const goNext = () => {
    if (currentPage < pageCount - 1) {
      setPageIndex(currentPage + 1);
      return;
    }
    if (canLoadMore) {
      setPageIndex(currentPage + 1);
      onLoadMore();
    }
  };

  const trackStyle = { '--filmstrip-columns': cardsPerPage } as CSSProperties;
  const innerStyle = { transform: `translate3d(-${currentPage * 100}%, 0, 0)` } as CSSProperties;

  return (
    <div className="board-filmstrip" role="region" aria-label={label}>
      <div className="board-filmstrip-track" id={id} style={trackStyle} aria-label={label}>
        <div className="board-filmstrip-inner" style={innerStyle}>
          {pages.map((page, index) => (
            <div className="board-filmstrip-page" key={index}>
              {page}
            </div>
          ))}
        </div>
      </div>
      <div className="board-filmstrip-controls">
        <button
          className="quiet-button"
          type="button"
          aria-label="Previous players"
          aria-controls={id}
          disabled={currentPage === 0}
          onClick={() => setPageIndex(Math.max(0, currentPage - 1))}
        >
          Previous
        </button>
        <span className="visually-hidden" aria-live="polite">{pageLabel(currentPage, itemCount, cardsPerPage)}</span>
        <button
          className="quiet-button"
          type="button"
          aria-label="Next players"
          aria-controls={id}
          disabled={currentPage === pageCount - 1 && !canLoadMore}
          onClick={goNext}
        >
          Next
        </button>
      </div>
    </div>
  );
}
