ALTER TABLE keep_notes
ADD COLUMN kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'checklist'));

CREATE TABLE keep_note_items (
    id TEXT PRIMARY KEY NOT NULL,
    note_id TEXT NOT NULL REFERENCES keep_notes(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (note_id, position)
);
