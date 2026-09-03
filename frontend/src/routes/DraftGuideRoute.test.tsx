import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { __resetPlayerPoolCache } from '../data/loadPlayerPool';

// Regression suite for the guide's URL-as-state contract (DECISIONS.md 2026-08-25). The selector
// state lives entirely in the query string, and `setSearchParams` replaces the WHOLE query —
// these tests pin that every control MERGES its patch into the current params instead of
// silently resetting every selector absent from the patch (the original implementation rebuilt
// the query from scratch, so changing source wiped scoring/qb/teams/rounds/pos and vice versa).
// They also pin the degrade-don't-crash contract for unknown `pos`/`source` deep links.

let currentSearch = '';

function LocationProbe() {
  const location = useLocation();
  currentSearch = location.search;
  return null;
}

function jsonOk(body: unknown) {
  return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: () => Promise.resolve(body) };
}

function notFound() {
  return { ok: false, status: 404, json: () => Promise.resolve(null) };
}

beforeEach(() => {
  localStorage.clear();
  __resetPlayerPoolCache();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    // Provider lanes stay selectable (empty boards are fine — these tests exercise selector
    // state, not table contents); every core-board artifact fails, keeping status 'error'
    // without ever running the engine.
    if (url.startsWith('/data/adp-')) return jsonOk([]);
    return notFound();
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(route: string) {
  currentSearch = '';
  render(
    <MemoryRouter initialEntries={[route]}>
      <LocationProbe />
      <AppRoutes />
    </MemoryRouter>,
  );
}

function params(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(currentSearch));
}

// The guide's filters are segmented chip groups (role="group" + aria-pressed buttons), not
// native selects — helpers mirror the old selectOptions ergonomics.
function chipGroup(name: string) {
  return screen.getByRole('group', { name });
}
async function clickChip(user: ReturnType<typeof userEvent.setup>, group: string, label: string) {
  await user.click(within(chipGroup(group)).getByRole('button', { name: label }));
}

describe('DraftGuideRoute URL state', () => {
  it('toggling a position preserves source and format params', async () => {
    const user = userEvent.setup();
    renderAt('/draft-guide?scoring=half-ppr&teams=8&rounds=13&source=sleeper');
    await screen.findByText(/The board, before draft day/);

    await clickChip(user, 'Position', 'WR');

    expect(params()).toEqual({
      scoring: 'half-ppr',
      teams: '8',
      rounds: '13',
      source: 'sleeper',
      pos: 'WR',
    });
  });

  it('changing Scoring preserves ranked-by and position params', async () => {
    const user = userEvent.setup();
    renderAt('/draft-guide?scoring=standard&source=sleeper&pos=TE');
    await screen.findByText(/The board, before draft day/);

    await clickChip(user, 'Scoring', 'PPR');

    // patchFormat re-serializes the whole format, so defaults become explicit here — but the
    // point of the test is that source and pos SURVIVE.
    expect(params()).toEqual({
      scoring: 'ppr',
      qb: 'one-qb',
      teams: '12',
      rounds: '15',
      source: 'sleeper',
      pos: 'TE',
    });
  });

  it('choosing All removes the pos key entirely (defaults live in the parser, not the URL)', async () => {
    const user = userEvent.setup();
    renderAt('/draft-guide?pos=RB&source=sleeper');
    await screen.findByText(/The board, before draft day/);

    await clickChip(user, 'Position', 'All');

    expect(params()).toEqual({ source: 'sleeper' });
  });

  it('an unknown pos param degrades to All rather than filtering everything away', async () => {
    renderAt('/draft-guide?pos=BOGUS');
    await screen.findByText(/The board, before draft day/);

    expect(within(chipGroup('Position')).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  // The "Ranked by" selector is gone: the board is Sleeper-ordered with the other providers as
  // reference columns. An unknown `source=` deep link must degrade to Sleeper silently (no crash,
  // no selector to reflect it in).
  it('an unknown source param degrades to Sleeper without a Ranked-by selector', async () => {
    renderAt('/draft-guide?source=ffc');
    await screen.findByText(/The board, before draft day/);

    expect(screen.queryByRole('group', { name: 'Ranked by' })).not.toBeInTheDocument();
    // The degrade itself is silent — the page reaches its settled (here: stubbed-error) state.
    expect(await screen.findByText(/unavailable right now/i)).toBeInTheDocument();
  });

  // The Draft View toggle (2c) goes through the same updateParams merge — pin that switching
  // views preserves every other selector, and that leaving the grid removes the key entirely.
  // The grid is a FULL-board view, so this drives from an unfiltered pool (the filtered case is
  // the disable-and-degrade contract pinned in its own test below).
  // Timeout: this test renders the full pool THREE times (table → grid → table) in jsdom; under
  // full-suite parallel load that has measured >30s. The assertions are the point, not the speed.
  it('toggling the draft-grid view preserves all other params; back to table drops the key', { timeout: 90_000 }, async () => {
    const user = userEvent.setup();
    // Serve the REAL core artifacts so the board reaches 'ready' and the toggle renders
    // (the suite default stub keeps the core failing to skip engine work in selector tests).
    const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
    const loadJson = (name: string): unknown => JSON.parse(readFileSync(join(dataDir, name), 'utf-8'));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(loadJson('players.json'));
      if (url === '/data/projections-season.json') return jsonOk(loadJson('projections-season.json'));
      if (url.startsWith('/data/adp-')) return jsonOk(loadJson(url.replace('/data/', '')));
      if (url.startsWith('/data/player-usage')) return jsonOk({});
      if (url.startsWith('/data/projections-providers')) return notFound();
      return notFound();
    }));

    renderAt('/draft-guide?scoring=ppr&qb=superflex&teams=10&rounds=13&source=sleeper');
    await screen.findByText(/The board, before draft day/);
    await screen.findByRole('table'); // table view is the default

    await user.click(screen.getByRole('button', { name: 'Draft' }));
    expect(params()).toEqual({
      scoring: 'ppr', qb: 'superflex', teams: '10', rounds: '13', source: 'sleeper', view: 'draft',
    });
    // The grid replaced the table (its header row labels the team slots; round label column present).
    expect(screen.getByRole('columnheader', { name: 'Round' })).toBeInTheDocument();
    const grid = screen.getByRole('table');
    expect(grid.className).toContain('guide-draft-grid');

    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(params()).toEqual({
      scoring: 'ppr', qb: 'superflex', teams: '10', rounds: '13', source: 'sleeper',
    });
  });

  // The guide's drawer must receive the SAME context the live Draft Room's does
  // (RecommendationBoard.tsx): Market ADP anchor from the active board, and a Weekly tab that
  // actually loads (here: honest 'unavailable' because the stub 404s weekly-stats.json) instead
  // of sitting idle forever. Regression guard for the Phase-3 starved-props wiring.
  // Timeout: the full-pool table + drawer render in jsdom; under full-suite parallel load this
  // can exceed the 5s default several times over.
  it('opens a fully-wired player drawer: Market ADP anchor + live Weekly tab state', { timeout: 60_000 }, async () => {
    const user = userEvent.setup();
    // Serve the REAL core artifacts AND manifest (season drives the weekly-stats fetch); only
    // weekly-stats itself 404s so the drawer must show its honest-unavailable state, not idle.
    const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
    const loadJson = (name: string): unknown => JSON.parse(readFileSync(join(dataDir, name), 'utf-8'));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/manifest.json') return jsonOk(loadJson('manifest.json'));
      if (url === '/data/players.json') return jsonOk(loadJson('players.json'));
      if (url === '/data/projections-season.json') return jsonOk(loadJson('projections-season.json'));
      if (url === '/data/player-usage.json') return jsonOk(loadJson('player-usage.json'));
      if (url.startsWith('/data/adp-')) return jsonOk(loadJson(url.replace('/data/', '')));
      if (url.startsWith('/data/weekly-stats')) return notFound();
      if (url.startsWith('/data/projections-providers')) return notFound();
      return notFound();
    }));

    renderAt('/draft-guide?source=sleeper');
    await screen.findByText(/The board, before draft day/);
    const table = await screen.findByRole('table');

    const playerButton = table.querySelector('button.guide-player-cell');
    expect(playerButton).not.toBeNull();
    await user.click(playerButton!);

    const dialog = await screen.findByRole('dialog');
    // Market ADP section is anchored to the active board (the starved wiring rendered no anchor).
    expect(within(dialog).getByRole('heading', { name: 'Market ADP' })).toBeInTheDocument();

    // Weekly tab resolves its fetch (idle → unavailable under the 404 stub) — proof the drawer's
    // weeklyStats prop is actually wired, not stuck on the IDLE default.
    await user.click(within(dialog).getByRole('tab', { name: 'Weekly' }));
    expect(await screen.findByText(/Weekly stats unavailable/i)).toBeInTheDocument();
  });

  // The draft grid is a FULL-board view: under a position filter the toggle disables (with an
  // explanatory note) and a `view=draft` deep link degrades to the table — a filtered pool would
  // misrepresent where players actually get picked. The param survives so clearing the filter
  // restores the grid.
  // Timeout: full-pool real-data board build + two renders; slow under parallel load.
  it('disables the draft grid under a position filter; view=draft deep link degrades to the table', { timeout: 60_000 }, async () => {
    const user = userEvent.setup();
    const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
    const loadJson = (name: string): unknown => JSON.parse(readFileSync(join(dataDir, name), 'utf-8'));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(loadJson('players.json'));
      if (url === '/data/projections-season.json') return jsonOk(loadJson('projections-season.json'));
      if (url.startsWith('/data/adp-')) return jsonOk(loadJson(url.replace('/data/', '')));
      if (url.startsWith('/data/player-usage')) return jsonOk({});
      if (url.startsWith('/data/projections-providers')) return notFound();
      return notFound();
    }));

    renderAt('/draft-guide?pos=QB&view=draft');
    await screen.findByText(/The board, before draft day/);
    await screen.findByRole('table'); // degraded to the table despite view=draft

    expect(screen.queryByRole('columnheader', { name: 'Round' })).not.toBeInTheDocument();
    const gridButton = screen.getByRole('button', { name: 'Draft' });
    expect(gridButton).toBeDisabled();
    // The explanatory note was removed (2026-08-26) — the disabled button is the only signal.
    expect(screen.queryByText(/set the position filter back to All/i)).not.toBeInTheDocument();
    expect(params()).toEqual({ pos: 'QB', view: 'draft' });

    // Clearing the filter re-enables the toggle, and the preserved view param brings the grid back.
    await clickChip(user, 'Position', 'All');
    expect(screen.getByRole('button', { name: 'Draft' })).toBeEnabled();
    expect(await screen.findByRole('columnheader', { name: 'Round' })).toBeInTheDocument();
    expect(params()).toEqual({ view: 'draft' });
  });
});
