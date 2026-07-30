import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KeepNote } from '../domain';
import { KeepPage } from './KeepPage';

const note: KeepNote = {
  id: 'note-1',
  title: 'Trip ideas',
  body: 'Take the night train',
  color: '#fff8b8',
  pinned: false,
  archived: false,
  createdAt: '2026-07-30T10:00:00Z',
  updatedAt: '2026-07-30T10:00:00Z',
};

function renderKeepPage(
  notes: readonly KeepNote[] = [],
  onCreate = vi.fn().mockResolvedValue(undefined),
  onUpdate = vi.fn().mockResolvedValue(undefined),
) {
  render(
    <KeepPage
      notes={notes}
      loading={false}
      query=""
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  return { onCreate, onUpdate };
}

describe('KeepPage', () => {
  it('creates a note in the in-app editor', async () => {
    const { onCreate } = renderKeepPage();

    fireEvent.click(screen.getByRole('button', { name: 'Take a note' }));
    expect(
      screen.getByRole('dialog', { name: 'New note' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Note title'), {
      target: { value: 'Packing list' },
    });
    fireEvent.change(screen.getByLabelText('Note body'), {
      target: { value: 'Passport and charger' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use mint color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith({
      title: 'Packing list',
      body: 'Passport and charger',
      color: '#a7ffeb',
      pinned: false,
      archived: false,
    });
  });

  it('archives an existing note from its quick actions', async () => {
    const { onUpdate } = renderKeepPage([note]);

    fireEvent.click(screen.getByRole('button', { name: 'Archive Trip ideas' }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(onUpdate).toHaveBeenCalledWith('note-1', {
      title: 'Trip ideas',
      body: 'Take the night train',
      color: '#fff8b8',
      pinned: false,
      archived: true,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
