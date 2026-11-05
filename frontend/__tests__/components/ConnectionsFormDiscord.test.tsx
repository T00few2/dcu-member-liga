import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectionsForm from '@/components/register/ConnectionsForm';

const base = {
  stravaConnected: true, zwiftConnected: true,
  handleConnectStrava: vi.fn(), handleDisconnectStrava: vi.fn(),
  handleConnectZwift: vi.fn(), handleDisconnectZwift: vi.fn(),
};

describe('ConnectionsForm Discord section', () => {
  it('offers to connect Discord when not linked', async () => {
    const connect = vi.fn();
    render(<ConnectionsForm {...base} discordUsername={null} handleConnectDiscord={connect} handleDisconnectDiscord={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Forbind Discord' }));
    expect(connect).toHaveBeenCalled();
  });

  it('shows that it is connecting while the Discord login starts', async () => {
    let finish!: () => void;
    const connect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<ConnectionsForm {...base} discordUsername={null} handleConnectDiscord={connect} handleDisconnectDiscord={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Forbind Discord' }));
    const busy = screen.getByRole('button', { name: 'Forbinder…' });
    expect(busy).toBeDisabled();
    await user.click(busy); // a second click does nothing
    expect(connect).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByRole('button', { name: 'Forbind Discord' })).toBeEnabled();
  });

  it('shows the linked account and unlinks it', async () => {
    const unlink = vi.fn();
    render(<ConnectionsForm {...base} discordUsername="rider" handleConnectDiscord={vi.fn()} handleDisconnectDiscord={unlink} />);
    expect(screen.getByText(/Forbundet som @rider/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Frakobl' });
    await userEvent.setup().click(buttons[buttons.length - 1]!);
    expect(unlink).toHaveBeenCalled();
  });

  it('hides the section without handlers', () => {
    render(<ConnectionsForm {...base} />);
    expect(screen.queryByText('Discord (valgfrit)')).not.toBeInTheDocument();
  });
});
