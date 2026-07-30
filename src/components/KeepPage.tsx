import { useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ListChecks,
  Pin,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import type {
  KeepNote,
  KeepNoteInput,
  KeepNoteItem,
  KeepNoteKind,
} from '../domain';
import { eventTextColor } from '../lib/color';
import { errorMessage } from '../lib/error';

type KeepPageProps = {
  notes: readonly KeepNote[];
  loading: boolean;
  error?: string;
  query: string;
  onCreate: (input: KeepNoteInput) => Promise<void>;
  onUpdate: (noteId: string, input: KeepNoteInput) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
};

type EditorState = {
  note?: KeepNote;
  input: KeepNoteInput;
};

const noteColors = [
  { value: '#f8f9fa', label: 'Paper' },
  { value: '#fff8b8', label: 'Lemon' },
  { value: '#f28b82', label: 'Coral' },
  { value: '#fbbc04', label: 'Amber' },
  { value: '#ccff90', label: 'Lime' },
  { value: '#a7ffeb', label: 'Mint' },
  { value: '#cbf0f8', label: 'Sky' },
  { value: '#d7aefb', label: 'Lavender' },
  { value: '#fdcfe8', label: 'Blush' },
] as const;

function noteInput(note: KeepNote): KeepNoteInput {
  return {
    kind: note.kind,
    title: note.title,
    body: note.body,
    items: note.items.map((item) => ({ ...item })),
    color: note.color,
    pinned: note.pinned,
    archived: note.archived,
  };
}

function newChecklistItem(): KeepNoteItem {
  return { id: crypto.randomUUID(), text: '', checked: false };
}

function newNoteInput(archived: boolean, kind: KeepNoteKind): KeepNoteInput {
  return {
    kind,
    title: '',
    body: '',
    items: kind === 'checklist' ? [newChecklistItem()] : [],
    color: noteColors[1].value,
    pinned: false,
    archived,
  };
}

export function KeepPage({
  notes,
  loading,
  error,
  query,
  onCreate,
  onUpdate,
  onDelete,
}: KeepPageProps) {
  const [filter, setFilter] = useState<'notes' | 'archive'>('notes');
  const [editor, setEditor] = useState<EditorState>();
  const [editorError, setEditorError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [actionNoteId, setActionNoteId] = useState<string>();

  useEffect(() => {
    if (!editor || busy) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditor(undefined);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, editor]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleNotes = notes.filter(
    (note) =>
      note.archived === (filter === 'archive') &&
      (normalizedQuery.length === 0 ||
        note.title.toLocaleLowerCase().includes(normalizedQuery) ||
        note.body.toLocaleLowerCase().includes(normalizedQuery)),
  );
  const pinnedNotes = visibleNotes.filter((note) => note.pinned);
  const otherNotes = visibleNotes.filter((note) => !note.pinned);

  const openEditor = (note?: KeepNote, kind: KeepNoteKind = 'text') => {
    setEditor({
      note,
      input: note ? noteInput(note) : newNoteInput(filter === 'archive', kind),
    });
    setEditorError(undefined);
  };

  const updateEditor = (patch: Partial<KeepNoteInput>) => {
    setEditor((current) =>
      current ? { ...current, input: { ...current.input, ...patch } } : current,
    );
  };

  const updateChecklistItem = (
    itemId: string,
    patch: Partial<KeepNoteItem>,
  ) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            input: {
              ...current.input,
              items: current.input.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item,
              ),
            },
          }
        : current,
    );
  };

  const saveEditor = () => {
    if (!editor) return;
    const input = {
      ...editor.input,
      title: editor.input.title.trim(),
      body: editor.input.kind === 'text' ? editor.input.body.trim() : '',
      items:
        editor.input.kind === 'checklist'
          ? editor.input.items
              .map((item) => ({ ...item, text: item.text.trim() }))
              .filter((item) => item.text)
          : [],
    };
    if (!input.title && !input.body && input.items.length === 0) {
      setEditorError(
        input.kind === 'checklist'
          ? 'Add a title or at least one list item before saving.'
          : 'Add a title or note before saving.',
      );
      return;
    }
    setBusy(true);
    setEditorError(undefined);
    const request = editor.note
      ? onUpdate(editor.note.id, input)
      : onCreate(input);
    void request
      .then(() => setEditor(undefined))
      .catch((reason: unknown) => {
        setEditorError(errorMessage(reason, 'Could not save the note.'));
      })
      .finally(() => setBusy(false));
  };

  const deleteNote = () => {
    if (!editor?.note) return;
    setBusy(true);
    setEditorError(undefined);
    void onDelete(editor.note.id)
      .then(() => setEditor(undefined))
      .catch((reason: unknown) => {
        setEditorError(errorMessage(reason, 'Could not delete the note.'));
      })
      .finally(() => setBusy(false));
  };

  const quickUpdate = (note: KeepNote, patch: Partial<KeepNoteInput>) => {
    setActionNoteId(note.id);
    setActionError(undefined);
    void onUpdate(note.id, { ...noteInput(note), ...patch })
      .catch((reason: unknown) => {
        setActionError(errorMessage(reason, 'Could not update the note.'));
      })
      .finally(() => setActionNoteId(undefined));
  };

  const renderCards = (sectionNotes: readonly KeepNote[]) => (
    <div className="keep-grid">
      {sectionNotes.map((note) => {
        const label = note.title.trim() ? note.title.trim() : 'Untitled note';
        const foreground = eventTextColor(note.color);
        return (
          <article
            className="keep-card"
            style={{ backgroundColor: note.color, color: foreground }}
            key={note.id}
          >
            <button
              type="button"
              className="keep-card__open"
              aria-label={`Edit ${label}`}
              onClick={() => openEditor(note)}
            >
              {note.title && <strong>{note.title}</strong>}
              {note.kind === 'text' && note.body && <p>{note.body}</p>}
            </button>
            {note.kind === 'checklist' && (
              <div className="keep-card__checklist">
                {note.items.slice(0, 8).map((item) => (
                  <label key={item.id} data-checked={item.checked}>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={actionNoteId === note.id}
                      onChange={() =>
                        quickUpdate(note, {
                          items: note.items.map((current) =>
                            current.id === item.id
                              ? { ...current, checked: !current.checked }
                              : current,
                          ),
                        })
                      }
                    />
                    <span>{item.text}</span>
                  </label>
                ))}
                {note.items.length > 8 && (
                  <small>+{note.items.length - 8} more</small>
                )}
              </div>
            )}
            <div className="keep-card__actions">
              <button
                type="button"
                aria-label={`${note.pinned ? 'Unpin' : 'Pin'} ${label}`}
                title={note.pinned ? 'Unpin' : 'Pin'}
                disabled={actionNoteId === note.id}
                onClick={(event) => {
                  event.stopPropagation();
                  quickUpdate(note, { pinned: !note.pinned });
                }}
              >
                <Pin size={16} fill={note.pinned ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                aria-label={`${note.archived ? 'Restore' : 'Archive'} ${label}`}
                title={note.archived ? 'Restore' : 'Archive'}
                disabled={actionNoteId === note.id}
                onClick={(event) => {
                  event.stopPropagation();
                  quickUpdate(note, { archived: !note.archived });
                }}
              >
                {note.archived ? (
                  <ArchiveRestore size={16} />
                ) : (
                  <Archive size={16} />
                )}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );

  return (
    <main className="page-surface keep-page" aria-busy={loading}>
      {loading && <div className="surface-loader" aria-label="Loading notes" />}
      <header className="keep-header">
        <div>
          <span className="eyebrow">Keep</span>
          <h1>Notes</h1>
        </div>
        <nav className="keep-filters" aria-label="Note filters">
          <button
            type="button"
            data-active={filter === 'notes'}
            aria-pressed={filter === 'notes'}
            onClick={() => setFilter('notes')}
          >
            <StickyNote size={16} /> Notes
          </button>
          <button
            type="button"
            data-active={filter === 'archive'}
            aria-pressed={filter === 'archive'}
            onClick={() => setFilter('archive')}
          >
            <Archive size={16} /> Archive
          </button>
        </nav>
      </header>

      <div className="keep-create-bar">
        <button
          type="button"
          className="keep-take-note"
          onClick={() => openEditor(undefined, 'text')}
        >
          <StickyNote size={20} />
          <span>Take a note</span>
        </button>
        <button
          type="button"
          className="keep-new-list"
          onClick={() => openEditor(undefined, 'checklist')}
        >
          <ListChecks size={19} /> New list
        </button>
      </div>

      {Boolean(error ?? actionError) && (
        <p className="keep-error" role="alert">
          {actionError ?? error}
        </p>
      )}

      {!loading && visibleNotes.length === 0 ? (
        <div className="keep-empty">
          <StickyNote size={35} />
          <h2>{query.trim() ? 'No matching notes' : `No ${filter} yet`}</h2>
          <p>
            {query.trim()
              ? 'Try a different search.'
              : filter === 'archive'
                ? 'Archived notes will appear here.'
                : 'Capture an idea, list, or reminder.'}
          </p>
        </div>
      ) : (
        <div className="keep-sections">
          {pinnedNotes.length > 0 && (
            <section aria-labelledby="keep-pinned-heading">
              <h2 id="keep-pinned-heading">Pinned</h2>
              {renderCards(pinnedNotes)}
            </section>
          )}
          {otherNotes.length > 0 && (
            <section aria-labelledby="keep-others-heading">
              <h2 id="keep-others-heading">
                {pinnedNotes.length > 0 ? 'Others' : 'Notes'}
              </h2>
              {renderCards(otherNotes)}
            </section>
          )}
        </div>
      )}

      {editor && (
        <div
          className="dialog-backdrop keep-editor-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setEditor(undefined);
            }
          }}
        >
          <section
            className="keep-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="keep-editor-title"
            style={{
              backgroundColor: editor.input.color,
              color: eventTextColor(editor.input.color),
            }}
          >
            <header>
              <h2 id="keep-editor-title">
                {editor.note
                  ? editor.input.kind === 'checklist'
                    ? 'Edit list'
                    : 'Edit note'
                  : editor.input.kind === 'checklist'
                    ? 'New list'
                    : 'New note'}
              </h2>
              <button
                type="button"
                className="keep-editor__icon"
                aria-label="Close editor"
                onClick={() => setEditor(undefined)}
                disabled={busy}
              >
                <X size={19} />
              </button>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveEditor();
              }}
            >
              <label>
                <span className="sr-only">Note title</span>
                <input
                  type="text"
                  autoFocus
                  value={editor.input.title}
                  onChange={(event) =>
                    updateEditor({ title: event.target.value })
                  }
                  placeholder="Title"
                  disabled={busy}
                />
              </label>
              {editor.input.kind === 'text' ? (
                <label>
                  <span className="sr-only">Note body</span>
                  <textarea
                    value={editor.input.body}
                    onChange={(event) =>
                      updateEditor({ body: event.target.value })
                    }
                    placeholder="Take a note…"
                    rows={8}
                    disabled={busy}
                  />
                </label>
              ) : (
                <div className="keep-checklist-editor">
                  {editor.input.items.map((item, index) => (
                    <div key={item.id}>
                      <input
                        type="checkbox"
                        aria-label={`Mark item ${String(index + 1)} complete`}
                        checked={item.checked}
                        onChange={(event) =>
                          updateChecklistItem(item.id, {
                            checked: event.target.checked,
                          })
                        }
                        disabled={busy}
                      />
                      <input
                        type="text"
                        aria-label={`List item ${String(index + 1)}`}
                        value={item.text}
                        onChange={(event) =>
                          updateChecklistItem(item.id, {
                            text: event.target.value,
                          })
                        }
                        placeholder="List item"
                        disabled={busy}
                      />
                      <button
                        type="button"
                        aria-label={`Remove item ${String(index + 1)}`}
                        onClick={() =>
                          updateEditor({
                            items: editor.input.items.filter(
                              (current) => current.id !== item.id,
                            ),
                          })
                        }
                        disabled={busy}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="keep-checklist-editor__add"
                    onClick={() =>
                      updateEditor({
                        items: [...editor.input.items, newChecklistItem()],
                      })
                    }
                    disabled={busy}
                  >
                    <Plus size={15} /> Add item
                  </button>
                </div>
              )}
              <fieldset className="keep-palette">
                <legend>Note color</legend>
                {noteColors.map((color) => (
                  <button
                    type="button"
                    key={color.value}
                    aria-label={`Use ${color.label.toLocaleLowerCase()} color`}
                    aria-pressed={editor.input.color === color.value}
                    title={color.label}
                    style={{ backgroundColor: color.value }}
                    onClick={() => updateEditor({ color: color.value })}
                    disabled={busy}
                  />
                ))}
              </fieldset>
              <div className="keep-editor__options">
                <label>
                  <input
                    type="checkbox"
                    checked={editor.input.pinned}
                    onChange={(event) =>
                      updateEditor({ pinned: event.target.checked })
                    }
                    disabled={busy}
                  />
                  <Pin size={15} /> Pinned
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editor.input.archived}
                    onChange={(event) =>
                      updateEditor({ archived: event.target.checked })
                    }
                    disabled={busy}
                  />
                  <Archive size={15} /> Archived
                </label>
              </div>
              {editorError && (
                <p className="keep-editor__error" role="alert">
                  {editorError}
                </p>
              )}
              <footer>
                {editor.note && (
                  <button
                    type="button"
                    className="keep-editor__delete"
                    onClick={deleteNote}
                    disabled={busy}
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                )}
                <span />
                <button
                  type="button"
                  className="keep-editor__button"
                  onClick={() => setEditor(undefined)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="keep-editor__button keep-editor__button--primary"
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
