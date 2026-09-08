CREATE TABLE attachments (
  id              TEXT PRIMARY KEY,
  content_hash    TEXT NOT NULL UNIQUE,
  relative_path   TEXT NOT NULL UNIQUE,
  original_name   TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  byte_size       INTEGER NOT NULL CHECK (byte_size >= 0),
  sync_state      TEXT NOT NULL DEFAULT 'local' CHECK (sync_state IN ('local', 'pending', 'synced')),
  created_at_ms   INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_attachments_sync_state
  ON attachments(sync_state, created_at_ms);

CREATE TABLE note_attachments (
  note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  PRIMARY KEY (note_id, attachment_id)
) STRICT;
