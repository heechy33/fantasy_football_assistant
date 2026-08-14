import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TeamsPage } from './TeamsPage';

describe('TeamsPage', () => {
  it('renders the empty-state shell with a clear heading', () => {
    render(<TeamsPage />);
    expect(screen.getByRole('heading', { name: 'Your teams' })).toBeInTheDocument();
    expect(screen.getByText(/Rosters and team management arrive in a later phase/)).toBeInTheDocument();
  });
});
