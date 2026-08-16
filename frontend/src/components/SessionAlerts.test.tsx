import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionAlerts } from './SessionAlerts';

describe('SessionAlerts', () => {
  it('renders nothing when there are no alerts', () => {
    const { container } = render(<SessionAlerts alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one alert role="alert" per fault', () => {
    render(
      <SessionAlerts
        alerts={[
          { id: 'no-extension', message: 'ESPN extension not detected.' },
          { id: 'desync', message: '2 picks were missed.' },
        ]}
      />,
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(screen.getByText('ESPN extension not detected.')).toBeInTheDocument();
    expect(screen.getByText('2 picks were missed.')).toBeInTheDocument();
  });

  it('exposes the seat-mismatch action and fires it on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SessionAlerts
        alerts={[{
          id: 'seat-mismatch',
          message: 'Draft position 2 disagrees with the live order.',
          severity: 'danger',
          action: { label: 'Edit draft setup', onSelect },
        }]}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-severity', 'danger');
    await user.click(screen.getByRole('button', { name: 'Edit draft setup' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
