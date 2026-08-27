import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

interface RenderWithRouterOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial URL for the in-memory history (default '/'). */
  route?: string;
}

/** Testing Library `render` wrapped in a `MemoryRouter` — the standard harness for any component
 * that navigates or renders `<Link>`s without dragging browser history into jsdom. */
export function renderWithRouter(ui: ReactElement, { route = '/', ...options }: RenderWithRouterOptions = {}) {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>, options);
}
