import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BoardFilmstrip, clampPageIndex, getPageCount } from './BoardFilmstrip';

describe('BoardFilmstrip page math', () => {
  it('calculates page counts and clamps indexes at render time', () => {
    expect(getPageCount(12, 3)).toBe(4);
    expect(getPageCount(5, 3)).toBe(2);
    expect(getPageCount(0, 3)).toBe(1);
    expect(clampPageIndex(-1, 4)).toBe(0);
    expect(clampPageIndex(9, 4)).toBe(3);
  });
});

describe('BoardFilmstrip controls', () => {
  it('keeps every loaded card in the DOM and disables arrows at both bounds', async () => {
    const user = userEvent.setup();
    render(
      <BoardFilmstrip itemCount={5} cardsPerPage={3} canLoadMore={false} onLoadMore={vi.fn()} label="Players">
        {Array.from({ length: 5 }, (_, index) => <div key={index}>Player {index + 1}</div>)}
      </BoardFilmstrip>,
    );

    expect(screen.getByText('Showing 1–3 of 5')).toHaveClass('visually-hidden');
    expect(screen.getByRole('button', { name: 'Previous players' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next players' })).not.toBeDisabled();
    expect(within(screen.getByRole('region', { name: 'Players' })).getAllByText(/Player/)).toHaveLength(5);

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(screen.getByText('Showing 4–5 of 5')).toHaveClass('visually-hidden');
    expect(screen.getByRole('button', { name: 'Previous players' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next players' })).toBeDisabled();
    expect(document.querySelector('.board-filmstrip-inner')).toHaveStyle({ transform: 'translate3d(-100%, 0, 0)' });
  });

  it('loads more only when the next arrow is pressed on the last loaded page', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    render(
      <BoardFilmstrip itemCount={3} cardsPerPage={3} canLoadMore label="Players" onLoadMore={onLoadMore}>
        <div>Player 1</div>
        <div>Player 2</div>
        <div>Player 3</div>
      </BoardFilmstrip>,
    );

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Previous players' })).toBeDisabled();
  });

  it('disables the next arrow on the last page when more rows cannot be loaded', () => {
    render(
      <BoardFilmstrip itemCount={3} cardsPerPage={3} canLoadMore={false} onLoadMore={vi.fn()} label="Players">
        <div>Player 1</div>
        <div>Player 2</div>
        <div>Player 3</div>
      </BoardFilmstrip>,
    );
    expect(screen.getByRole('button', { name: 'Next players' })).toBeDisabled();
  });

  it('does not render page-dot controls', () => {
    render(
      <BoardFilmstrip itemCount={5} cardsPerPage={3} canLoadMore={false} onLoadMore={vi.fn()} label="Players">
        {Array.from({ length: 5 }, (_, index) => <div key={index}>Player {index + 1}</div>)}
      </BoardFilmstrip>,
    );
    expect(screen.queryByRole('button', { name: /Show page/ })).not.toBeInTheDocument();
    expect(document.querySelector('.board-filmstrip-dots')).toBeNull();
  });

  it('places Previous/Next after the card track', () => {
    render(
      <BoardFilmstrip itemCount={3} cardsPerPage={3} canLoadMore={false} onLoadMore={vi.fn()} label="Players">
        <div>Player 1</div>
        <div>Player 2</div>
        <div>Player 3</div>
      </BoardFilmstrip>,
    );
    const region = screen.getByRole('region', { name: 'Players' });
    const children = Array.from(region.children).map((el) => el.className);
    expect(children).toEqual(['board-filmstrip-track', 'board-filmstrip-controls']);
  });
});
