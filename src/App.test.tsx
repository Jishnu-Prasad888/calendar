import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('opens the event composer and creates an event', async () => {
    render(<App />);
    expect(await screen.findByText('Clay Calendar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.change(screen.getByPlaceholderText('Add title'), {
      target: { value: 'Architecture sync' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Architecture sync')).toBeInTheDocument();
  });

  it('keeps tasks on a separate read-only page', async () => {
    render(<App />);
    await screen.findByText('Clay Calendar');
    fireEvent.click(screen.getByRole('button', { name: /Tasks/ }));

    expect(await screen.findByText('Prepare launch notes')).toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Create task/i }),
    ).not.toBeInTheDocument();
  });

  it('creates and edits local Keep-style notes', async () => {
    render(<App />);
    await screen.findByText('Clay Calendar');
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(await screen.findByText('Welcome to Notes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take a note' }));
    fireEvent.change(screen.getByLabelText('Note title'), {
      target: { value: 'Release ideas' },
    });
    fireEvent.change(screen.getByLabelText('Note body'), {
      target: { value: 'Add keyboard shortcuts' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Release ideas')).toBeInTheDocument();
  });
});
