import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  AlignLeft,
  CalendarDays,
  Check,
  ClipboardList,
  ListTodo,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { Task, TaskInput, TaskList } from '../domain';
import { dateKey } from '../lib/date';
import { errorMessage } from '../lib/error';
import { DateTimePicker } from './DateTimePicker';

type TasksPageProps = {
  taskLists: readonly TaskList[];
  loading: boolean;
  error?: string;
  onCreate: (input: TaskInput) => Promise<void>;
  onUpdate: (taskId: string, input: TaskInput) => Promise<void>;
  onDelete: (taskId: string, taskListId: string) => Promise<void>;
};

type TaskEditor = {
  task?: Task;
  input: TaskInput;
};

function taskInput(
  task: Task,
  taskListId: string,
  patch?: Partial<TaskInput>,
): TaskInput {
  return {
    taskListId,
    title: task.title,
    notes: task.notes,
    due: task.due,
    completed: task.completed,
    ...patch,
  };
}

function formatDue(due: string): string {
  return new Date(`${due.slice(0, 10)}T12:00:00`).toLocaleDateString(
    undefined,
    { month: 'short', day: 'numeric' },
  );
}

export function TasksPage({
  taskLists,
  loading,
  error,
  onCreate,
  onUpdate,
  onDelete,
}: TasksPageProps) {
  const [editor, setEditor] = useState<TaskEditor>();
  const [editorError, setEditorError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [updatingTask, setUpdatingTask] = useState<string>();
  const [duePickerOpen, setDuePickerOpen] = useState(false);

  useEffect(() => {
    if (!editor || busy) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditor(undefined);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, editor]);

  const openCreate = (taskListId: string) => {
    setEditor({
      input: {
        taskListId,
        title: '',
        completed: false,
      },
    });
    setEditorError(undefined);
    setDuePickerOpen(false);
  };

  const openEdit = (task: Task, taskListId: string) => {
    setEditor({ task, input: taskInput(task, taskListId) });
    setEditorError(undefined);
    setDuePickerOpen(false);
  };

  const closeEditor = () => {
    if (busy) return;
    setEditor(undefined);
    setDuePickerOpen(false);
  };

  const saveEditor = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor) return;
    const title = editor.input.title.trim();
    if (!title) {
      setEditorError('Add a title before saving.');
      return;
    }
    const notes = editor.input.notes?.trim();

    const input: TaskInput = {
      ...editor.input,
      title,
      notes: notes === '' ? undefined : notes,
    };
    setBusy(true);
    setEditorError(undefined);
    try {
      if (editor.task) await onUpdate(editor.task.id, input);
      else await onCreate(input);
      setEditor(undefined);
      setDuePickerOpen(false);
    } catch (reason: unknown) {
      setEditorError(errorMessage(reason, 'Could not save the task.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteTask = async () => {
    if (!editor?.task) return;
    setBusy(true);
    setEditorError(undefined);
    try {
      await onDelete(editor.task.id, editor.input.taskListId);
      setEditor(undefined);
    } catch (reason: unknown) {
      setEditorError(errorMessage(reason, 'Could not delete the task.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleTask = async (task: Task, taskListId: string) => {
    const actionKey = `${taskListId}:${task.id}`;
    setUpdatingTask(actionKey);
    setActionError(undefined);
    try {
      await onUpdate(
        task.id,
        taskInput(task, taskListId, { completed: !task.completed }),
      );
    } catch (reason: unknown) {
      setActionError(errorMessage(reason, 'Could not update the task.'));
    } finally {
      setUpdatingTask(undefined);
    }
  };

  const updateEditor = (patch: Partial<TaskInput>) => {
    setEditor((current) =>
      current ? { ...current, input: { ...current.input, ...patch } } : current,
    );
    setEditorError(undefined);
  };

  return (
    <main className="page-surface tasks-page">
      {loading && (
        <div
          className="surface-loader"
          role="status"
          aria-label="Loading tasks"
        />
      )}
      <header className="page-heading tasks-page__heading">
        <div>
          <span className="eyebrow">Google Tasks</span>
          <h1>Tasks</h1>
          <p>Capture work, set due dates, and keep every list moving.</p>
        </div>
      </header>

      {(error !== undefined || actionError !== undefined) && (
        <p className="tasks-page__error" role="alert">
          {actionError ?? error}
        </p>
      )}

      {taskLists.length === 0 ? (
        <div className="tasks-page__empty">
          <ClipboardList size={30} />
          <strong>No task lists available</strong>
          <span>Your Google Tasks lists will appear here.</span>
        </div>
      ) : (
        <div className="task-columns">
          {taskLists.map((list) => {
            const remaining = list.tasks.filter(
              (task) => !task.completed,
            ).length;
            return (
              <section className="task-list" key={list.id}>
                <header>
                  <span className="task-list__title">
                    <ClipboardList size={17} />
                    <strong>{list.title}</strong>
                  </span>
                  <small>{remaining} open</small>
                </header>
                <div className="task-list__items">
                  {list.tasks.length === 0 && (
                    <p className="task-list__empty">
                      No tasks in this list yet.
                    </p>
                  )}
                  {list.tasks.map((task) => {
                    const actionKey = `${list.id}:${task.id}`;
                    return (
                      <article
                        className="task-item"
                        data-completed={task.completed}
                        key={task.id}
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={task.completed}
                          aria-label={`${task.completed ? 'Mark incomplete' : 'Mark complete'}: ${task.title}`}
                          className="task-check"
                          disabled={updatingTask === actionKey}
                          onClick={() => void toggleTask(task, list.id)}
                        >
                          {task.completed && <Check size={13} />}
                        </button>
                        <button
                          type="button"
                          className="task-item__content"
                          aria-label={`Edit ${task.title}`}
                          onClick={() => openEdit(task, list.id)}
                        >
                          <strong>{task.title}</strong>
                          {task.notes && <p>{task.notes}</p>}
                          {task.due && (
                            <time dateTime={task.due}>
                              Due {formatDue(task.due)}
                            </time>
                          )}
                        </button>
                      </article>
                    );
                  })}
                </div>
                <footer>
                  <button type="button" onClick={() => openCreate(list.id)}>
                    <Plus size={15} /> Add task
                  </button>
                </footer>
              </section>
            );
          })}
        </div>
      )}

      {editor && (
        <div
          className="dialog-backdrop task-editor-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <section
            className="task-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-editor-title"
          >
            <header>
              <span className="dialog-icon">
                <ListTodo size={19} />
              </span>
              <div>
                <small>{editor.task ? 'Task details' : 'New task'}</small>
                <h2 id="task-editor-title">
                  {editor.task ? editor.task.title : 'Create task'}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close task editor"
                onClick={closeEditor}
                disabled={busy}
              >
                <X size={19} />
              </button>
            </header>

            <form onSubmit={(event) => void saveEditor(event)}>
              <label className="task-editor__title">
                <span>Title</span>
                <input
                  autoFocus
                  value={editor.input.title}
                  onChange={(event) =>
                    updateEditor({ title: event.target.value })
                  }
                  placeholder="Add title"
                  disabled={busy}
                />
              </label>

              <label className="task-editor__field">
                <ClipboardList size={18} />
                <span>Task list</span>
                <select
                  aria-label="Task list"
                  value={editor.input.taskListId}
                  onChange={(event) =>
                    updateEditor({ taskListId: event.target.value })
                  }
                  disabled={Boolean(editor.task) || busy}
                >
                  {taskLists.map((list) => (
                    <option value={list.id} key={list.id}>
                      {list.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="task-editor__field task-editor__field--notes">
                <AlignLeft size={18} />
                <span>Notes</span>
                <textarea
                  aria-label="Notes"
                  value={editor.input.notes ?? ''}
                  onChange={(event) =>
                    updateEditor({ notes: event.target.value })
                  }
                  placeholder="Add notes"
                  rows={4}
                  disabled={busy}
                />
              </label>

              <div className="task-editor__field task-editor__due">
                <CalendarDays size={18} />
                <span>Due date</span>
                {editor.input.due ? (
                  <div className="task-editor__due-control">
                    <DateTimePicker
                      label="Due date"
                      value={editor.input.due.slice(0, 10)}
                      allDay
                      open={duePickerOpen}
                      disabled={busy}
                      onChange={(due) => updateEditor({ due })}
                      onToggle={() => setDuePickerOpen((open) => !open)}
                      onClose={() => setDuePickerOpen(false)}
                    />
                    <button
                      type="button"
                      className="task-editor__clear-due"
                      aria-label="Clear due date"
                      onClick={() => {
                        updateEditor({ due: undefined });
                        setDuePickerOpen(false);
                      }}
                      disabled={busy}
                    >
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="task-editor__add-due"
                    onClick={() => {
                      updateEditor({ due: dateKey(new Date()) });
                      setDuePickerOpen(true);
                    }}
                    disabled={busy}
                  >
                    Add due date
                  </button>
                )}
              </div>

              <label className="task-editor__completed">
                <input
                  type="checkbox"
                  checked={editor.input.completed}
                  onChange={(event) =>
                    updateEditor({ completed: event.target.checked })
                  }
                  disabled={busy}
                />
                <span /> Completed
              </label>

              {editorError && (
                <p className="task-editor__error" role="alert">
                  {editorError}
                </p>
              )}

              <footer>
                {editor.task && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => void deleteTask()}
                    disabled={busy}
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                )}
                <span />
                <button
                  type="button"
                  className="soft-button"
                  onClick={closeEditor}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={busy}
                >
                  {busy ? 'Saving...' : 'Save'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
