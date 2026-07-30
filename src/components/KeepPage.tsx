import { useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Pin,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import type { KeepNote, KeepNoteInput } from '../domain';
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
    title: note.title,
    body: note.body,
    color: note.color,
    pinned: note.pinned,
    archived: note.archived,
  };
}

function newNoteInput(archived: boolean): KeepNoteInput {
  return {
    title: '',
    body: '',
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

  const openEditor = (note?: KeepNote) => {
    setEditor({
      note,
      input: note ? noteInput(note) : newNoteInput(filter === 'archive'),
    });
    setEditorError(undefined);
  };

  const updateEditor = (patch: Partial<KeepNoteInput>) => {
    setEditor((current) =>
      current ? { ...current, input: { ...current.input, ...patch } } : current,
    );
  };

  const saveEditor = () => {
    if (!editor) return;
    const input = {
      ...editor.input,
      title: editor.input.title.trim(),
      body: editor.input.body.trim(),
    };
    if (!input.title && !input.body) {
      setEditorError('Add a title or note before saving.');
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
              {note.body && <p>{note.body}</p>}
            </button>
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

      <button
        type="button"
        className="keep-take-note"
        onClick={() => openEditor()}
      >
        <StickyNote size={20} />
        <span>Take a note</span>
      </button>

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
                {editor.note ? 'Edit note' : 'New note'}
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
