import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { __resetFantasyProsAdpCache } from './data/fantasyProsAdp';
import { __resetFantasyProsStarsCache } from './data/fantasyProsStars';
import { __resetWeeklyScoringCache } from './data/loadWeeklyScoring';
import { __resetWeeklyStatsCache } from './data/loadWeeklyStats';
import { __resetProviderProjectionsCache } from './data/providerProjections';

afterEach(() => {
  __resetFantasyProsAdpCache();
  __resetFantasyProsStarsCache();
  __resetProviderProjectionsCache();
  __resetWeeklyScoringCache();
  __resetWeeklyStatsCache();
});

// First component test suite in the repo (see PLAN.md's testing-philosophy note) — every other
// module here is still tested as a pure function against real committed data or fixtures. This
// setup file only extends `expect` with jest-dom's DOM matchers (`toBeVisible`, `toHaveFocus`, …)
// for the DraftWorkspace component tests, plus a couple of jsdom gaps below.

// jsdom doesn't implement scrollIntoView (no real layout engine) — DraftLog calls it
// unconditionally on mount/on-the-clock change, which throws in every test that renders it
// without this stub, not just tests that click "Go to current pick".
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
