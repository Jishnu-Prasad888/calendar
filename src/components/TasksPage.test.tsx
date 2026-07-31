import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskList } from '../domain';
import { TasksPage } from './TasksPage';

const taskLists: readonly TaskList[] = [
  {
    id: 'personal',
    title: 'Personal',
    tasks: [
      {
        id: 'task-1',
        title: 'Book train',
        notes: 'Window seat',
        due: '2026-08-04',
        completed: false,
        updatedAt: '2026-07-31T10:00:00Z',
      },
    ],
  },
  { id: 'work', title: 'Work', tasks: [] },
];

function renderPage(
  onCreate = vi.fn().mockResolvedValue(undefined),
  onUpdate = vi.fn().mockResolvedValue(undefined),
  onDelete = vi.fn().mockResolvedValue(undefined),
) {
  render(
    <TasksPage
      taskLists={taskLists}
      loading={false}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />,
  );
  return { onCreate, onUpdate, onDelete };
}

describe('TasksPage', () => {
  it('creates a task in the selected list', async () => {
    const { onCreate } = renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add task' })[1]);
    expect(
      screen.getByRole('dialog', { name: 'Create task' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Task list')).toHaveValue('work');
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Prepare agenda' },
    });
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Share before lunch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith({
      taskListId: 'work',
      title: 'Prepare agenda',
      notes: 'Share before lunch',
      completed: false,
    });
  });

  it('toggles completion while preserving the task fields and list', async () => {
    const { onUpdate } = renderPage();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Mark complete: Book train' }),
    );

    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(onUpdate).toHaveBeenCalledWith('task-1', {
      taskListId: 'personal',
      title: 'Book train',
      notes: 'Window seat',
      due: '2026-08-04',
      completed: true,
    });
  });

  it('edits and deletes an existing task from the editor', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const view = renderPage(undefined, onUpdate, onDelete);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Book train' }));
    expect(screen.getByLabelText('Task list')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Book sleeper train' },
    });
    fireEvent.click(screen.getByLabelText('Completed'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(onUpdate).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        taskListId: 'personal',
        title: 'Book sleeper train',
        completed: true,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Book train' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    expect(view.onDelete).toHaveBeenCalledWith('task-1', 'personal');
  });

  it('uses the in-app all-day picker instead of native date inputs', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Book train' }));

    expect(
      document.querySelector(
        'input[type="date"], input[type="datetime-local"]',
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Due date:/ }));
    expect(
      screen.getByRole('dialog', { name: 'Due date date picker' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
