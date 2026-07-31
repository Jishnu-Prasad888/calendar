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

  it('creates and completes tasks on a separate page', async () => {
    render(<App />);
    await screen.findByText('Clay Calendar');
    fireEvent.click(screen.getByRole('button', { name: /Tasks/ }));

    expect(await screen.findByText('Prepare launch notes')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add task' })[0]);
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Publish release notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Publish release notes'),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Mark complete: Publish release notes',
      }),
    );
    expect(
      await screen.findByRole('checkbox', {
        name: 'Mark incomplete: Publish release notes',
      }),
    ).toBeChecked();
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
