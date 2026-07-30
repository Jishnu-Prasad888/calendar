import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KeepNote } from '../domain';
import { KeepPage } from './KeepPage';

const note: KeepNote = {
  id: 'note-1',
  kind: 'text',
  title: 'Trip ideas',
  body: 'Take the night train',
  items: [],
  color: '#fff8b8',
  pinned: false,
  archived: false,
  createdAt: '2026-07-30T10:00:00Z',
  updatedAt: '2026-07-30T10:00:00Z',
};

const checklistNote: KeepNote = {
  id: 'note-list',
  kind: 'checklist',
  title: 'Project',
  body: '',
  items: [
    { id: 'parent', text: 'Build', checked: false, indent: 0 },
    { id: 'child', text: 'Tests', checked: true, indent: 1 },
    { id: 'sibling', text: 'Ship', checked: false, indent: 0 },
  ],
  color: '#cbf0f8',
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
      kind: 'text',
      title: 'Packing list',
      body: 'Passport and charger',
      items: [],
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
      kind: 'text',
      title: 'Trip ideas',
      body: 'Take the night train',
      items: [],
      color: '#fff8b8',
      pinned: false,
      archived: true,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('creates a checklist with editable sub-items', async () => {
    const { onCreate } = renderKeepPage();

    fireEvent.click(screen.getByRole('button', { name: 'New list' }));
    expect(
      screen.getByRole('dialog', { name: 'New list' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Note title'), {
      target: { value: 'Groceries' },
    });
    fireEvent.change(screen.getByLabelText('List item 1'), {
      target: { value: 'Milk' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    fireEvent.change(screen.getByLabelText('List item 2'), {
      target: { value: 'Bread' },
    });
    fireEvent.click(screen.getByLabelText('Mark item 2 complete'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'checklist',
        title: 'Groceries',
        body: '',
        items: [
          expect.objectContaining({ text: 'Milk', checked: false }),
          expect.objectContaining({ text: 'Bread', checked: true }),
        ],
      }),
    );
  });

  it('deletes a list item together with nested items', async () => {
    const { onUpdate } = renderKeepPage([checklistNote]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Project' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove item 1 and nested items',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(onUpdate).toHaveBeenCalledWith(
      'note-list',
      expect.objectContaining({
        items: [{ id: 'sibling', text: 'Ship', checked: false, indent: 0 }],
      }),
    );
  });

  it('supports undo and redo buttons and keyboard shortcuts', () => {
    renderKeepPage([note]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Trip ideas' }));
    const title = screen.getByLabelText('Note title');
    fireEvent.change(title, { target: { value: 'First edit' } });
    fireEvent.change(title, { target: { value: 'Second edit' } });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(title).toHaveValue('First edit');
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(title).toHaveValue('Second edit');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(title).toHaveValue('First edit');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(title).toHaveValue('Second edit');
  });

  it('keeps checked items in a collapsed completed section', () => {
    renderKeepPage([checklistNote]);

    const completed = screen.getByText('Completed (1)').closest('details');
    expect(completed).not.toHaveAttribute('open');
    expect(screen.getByText('Build')).toBeVisible();
  });

  it('outdents checked items with the batch arrow control', async () => {
    const { onUpdate } = renderKeepPage([checklistNote]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Project' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Outdent checked items' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(onUpdate).toHaveBeenCalledWith(
      'note-list',
      expect.objectContaining({
        items: [
          { id: 'parent', text: 'Build', checked: false, indent: 0 },
          { id: 'child', text: 'Tests', checked: true, indent: 0 },
          { id: 'sibling', text: 'Ship', checked: false, indent: 0 },
        ],
      }),
    );
  });

  it('uses a non-text drag payload so item IDs are not inserted into fields', () => {
    renderKeepPage([checklistNote]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Project' }));
    const setData = vi.fn();

    fireEvent.dragStart(
      screen.getByRole('button', {
        name: 'Drag item 1 left or right to change nesting',
      }),
      {
        clientX: 100,
        dataTransfer: { effectAllowed: 'none', setData },
      },
    );

    expect(setData).toHaveBeenCalledWith(
      'application/x-clay-checklist-item',
      'parent',
    );
    expect(screen.getByLabelText('List item 1')).toHaveValue('Build');
  });
});
