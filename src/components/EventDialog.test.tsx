import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarSource } from '../domain';
import { EventDialog } from './EventDialog';

const draft = {
  start: '2026-07-30T09:00:00Z',
  end: '2026-07-30T10:00:00Z',
  allDay: false,
};

const calendar: CalendarSource = {
  id: 'primary',
  accountId: 'account',
  name: 'Primary',
  color: '#1a73e8',
  primary: true,
  readOnly: false,
  visible: true,
};

function renderDialog(
  calendars: readonly CalendarSource[],
  onSave = vi.fn().mockResolvedValue(undefined),
) {
  render(
    <EventDialog
      draft={draft}
      calendars={calendars}
      busy={false}
      onClose={vi.fn()}
      onSave={onSave}
      onDelete={vi.fn()}
      onRespond={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText('Add title'), {
    target: { value: 'Planning' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return onSave;
}

describe('EventDialog', () => {
  it('explains that an editable calendar is required', () => {
    const onSave = renderDialog([]);

    expect(screen.getByText('No editable calendars')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Connect a Google account with an editable calendar before saving.',
      ),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows string errors returned by Tauri', async () => {
    renderDialog(
      [calendar],
      vi.fn().mockRejectedValue('validation error: calendar is read-only'),
    );

    await waitFor(() => {
      expect(
        screen.getByText('validation error: calendar is read-only'),
      ).toBeInTheDocument();
    });
  });
});
