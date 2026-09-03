PRAGMA foreign_keys = ON;

CREATE TABLE app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE notes (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  title_source     TEXT NOT NULL,
  body_ciphertext  BLOB NOT NULL,
  body_nonce       BLOB NOT NULL,
  body_key_id      TEXT NOT NULL,
  color            TEXT NOT NULL,
  created_at_ms    INTEGER NOT NULL,
  updated_at_ms    INTEGER NOT NULL,
  archived_at_ms   INTEGER,
  deleted_at_ms    INTEGER,
  sort_key         TEXT NOT NULL,
  text_direction   TEXT NOT NULL,
  revision         INTEGER NOT NULL CHECK (revision >= 1)
) STRICT;

CREATE INDEX idx_notes_active_sort
  ON notes(deleted_at_ms, archived_at_ms, sort_key);

CREATE INDEX idx_notes_updated
  ON notes(updated_at_ms, id);

CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value_json    TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE undo_operations (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  payload_json  TEXT NOT NULL CHECK (json_valid(payload_json)),
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_undo_operations_expires_at
  ON undo_operations(expires_at_ms);
