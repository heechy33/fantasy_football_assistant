import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { __resetWeeklyScoringCache } from './data/loadWeeklyScoring';
import { __resetWeeklyStatsCache } from './data/loadWeeklyStats';
import { __resetProviderProjectionsCache } from './data/providerProjections';

afterEach(() => {
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
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Same gap for scrollBy — DraftLog's auto-follow scrolls its own list container (via
// `Element.scrollBy`) instead of `scrollIntoView` walking every scrollable ancestor, so it needs
// the same stub.
if (typeof Element !== 'undefined' && !Element.prototype.scrollBy) {
  Element.prototype.scrollBy = () => {};
}
