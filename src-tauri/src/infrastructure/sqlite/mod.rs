use std::{collections::HashSet, path::Path, time::Duration};

use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    ConnectOptions, SqlitePool,
};
use thiserror::Error;

use crate::domain::note::{CreateNoteInput, NoteRecord, NoteScope, UpdateNoteInput};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
}

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("could not create the application data directory: {0}")]
    CreateDirectory(#[source] std::io::Error),
    #[error("could not open SQLite: {0}")]
    Connect(#[source] sqlx::Error),
    #[error("could not migrate SQLite: {0}")]
    Migrate(#[source] sqlx::migrate::MigrateError),
    #[error("SQLite health check failed: {0}")]
    HealthCheck(#[source] sqlx::Error),
    #[error("SQLite query failed: {0}")]
    Query(#[source] sqlx::Error),
    #[error("note was not found")]
    NotFound,
    #[error("note revision conflict (expected {expected}, actual {actual})")]
    RevisionConflict { expected: i64, actual: i64 },
    #[error("note cannot be changed from its current state")]
    InvalidState,
}

impl Database {
    pub async fn open(app_data_dir: &Path) -> Result<Self, DatabaseError> {
        std::fs::create_dir_all(app_data_dir).map_err(DatabaseError::CreateDirectory)?;
        let database_path = app_data_dir.join("flank.sqlite3");

        let options = SqliteConnectOptions::new()
            .filename(database_path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5))
            .disable_statement_logging();

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .map_err(DatabaseError::Connect)?;

        MIGRATOR.run(&pool).await.map_err(DatabaseError::Migrate)?;

        Ok(Self { pool })
    }

    pub async fn health_check(&self) -> Result<(), DatabaseError> {
        sqlx::query_scalar::<_, i64>("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .map(|_| ())
            .map_err(DatabaseError::HealthCheck)
    }

    pub async fn setting(&self, key: &str) -> Result<Option<String>, DatabaseError> {
        sqlx::query_scalar::<_, String>("SELECT value_json FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(DatabaseError::Query)
    }

    pub async fn save_setting(&self, key: &str, value_json: &str) -> Result<(), DatabaseError> {
        let updated_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        sqlx::query(
            "INSERT INTO settings (key, value_json, updated_at_ms) VALUES (?, ?, ?) \
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(key)
        .bind(value_json)
        .bind(updated_at_ms)
        .execute(&self.pool)
        .await
        .map(|_| ())
        .map_err(DatabaseError::Query)
    }

    pub async fn list_notes(
        &self,
        scope: NoteScope,
        query: &str,
    ) -> Result<Vec<NoteRecord>, DatabaseError> {
        let predicate = match scope {
            NoteScope::Active => "deleted_at_ms IS NULL AND archived_at_ms IS NULL",
            NoteScope::Archived => "deleted_at_ms IS NULL AND archived_at_ms IS NOT NULL",
            NoteScope::Deleted => "deleted_at_ms IS NOT NULL AND deleted_at_ms > (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 2592000000)",
        };
        let order = match scope {
            NoteScope::Active => "sort_key ASC, updated_at_ms DESC",
            NoteScope::Archived => "archived_at_ms DESC, updated_at_ms DESC",
            NoteScope::Deleted => "deleted_at_ms DESC",
        };
        let sql = format!(
            "SELECT id, title, body_ciphertext, color, created_at_ms, updated_at_ms, archived_at_ms, deleted_at_ms, sort_key, text_direction, revision FROM notes WHERE {predicate} ORDER BY {order}"
        );
        let rows = sqlx::query_as::<_, NoteRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(DatabaseError::Query)?;
        let needle = query.trim().to_lowercase();
        Ok(rows
            .into_iter()
            .map(NoteRecord::from)
            .filter(|note| {
                needle.is_empty()
                    || note.title.to_lowercase().contains(&needle)
                    || note.body.to_lowercase().contains(&needle)
            })
            .collect())
    }

    pub async fn create_note(&self, input: CreateNoteInput) -> Result<NoteRecord, DatabaseError> {
        let now = now_ms();
        let id = uuid::Uuid::new_v4().to_string();
        let sort_key = format!("{:020}-{id}", i64::MAX - now);
        sqlx::query("INSERT INTO notes (id, title, title_source, body_ciphertext, body_nonce, body_key_id, color, created_at_ms, updated_at_ms, archived_at_ms, deleted_at_ms, sort_key, text_direction, revision) VALUES (?, ?, 'explicit', ?, X'', 'local-v1', ?, ?, ?, NULL, NULL, ?, ?, 1)")
            .bind(&id)
            .bind(input.title.trim())
            .bind(input.body.as_bytes())
            .bind(&input.color)
            .bind(now)
            .bind(now)
            .bind(&sort_key)
            .bind(&input.text_direction)
            .execute(&self.pool)
            .await
            .map_err(DatabaseError::Query)?;
        self.note_by_id(&id).await
    }

    pub async fn update_note(&self, input: UpdateNoteInput) -> Result<NoteRecord, DatabaseError> {
        let result = sqlx::query("UPDATE notes SET title = ?, body_ciphertext = ?, color = ?, text_direction = ?, updated_at_ms = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at_ms IS NULL")
            .bind(input.title.trim())
            .bind(input.body.as_bytes())
            .bind(&input.color)
            .bind(&input.text_direction)
            .bind(now_ms())
            .bind(&input.id)
            .bind(input.expected_revision)
            .execute(&self.pool)
            .await
            .map_err(DatabaseError::Query)?;
        if result.rows_affected() == 0 {
            return Err(self
                .mutation_error(&input.id, input.expected_revision)
                .await?);
        }
        self.note_by_id(&input.id).await
    }

    pub async fn reorder_active_notes(&self, note_ids: &[String]) -> Result<(), DatabaseError> {
        let mut transaction = self.pool.begin().await.map_err(DatabaseError::Query)?;
        let active_ids = sqlx::query_scalar::<_, String>(
            "SELECT id FROM notes WHERE deleted_at_ms IS NULL AND archived_at_ms IS NULL",
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(DatabaseError::Query)?;
        let supplied: HashSet<&str> = note_ids.iter().map(String::as_str).collect();
        if supplied.len() != note_ids.len()
            || active_ids.len() != note_ids.len()
            || active_ids.iter().any(|id| !supplied.contains(id.as_str()))
        {
            return Err(DatabaseError::InvalidState);
        }

        // Keep the current-time ordering scheme: notes created after this
        // transaction receive a smaller key and therefore still appear first.
        let base = i64::MAX - now_ms();
        for (index, id) in note_ids.iter().enumerate() {
            let sort_key = format!("{:020}-{id}", base + index as i64);
            let result = sqlx::query(
                "UPDATE notes SET sort_key = ? WHERE id = ? AND deleted_at_ms IS NULL AND archived_at_ms IS NULL",
            )
            .bind(sort_key)
            .bind(id)
            .execute(&mut *transaction)
            .await
            .map_err(DatabaseError::Query)?;
            if result.rows_affected() != 1 {
                return Err(DatabaseError::InvalidState);
            }
        }
        transaction.commit().await.map_err(DatabaseError::Query)
    }

    pub async fn archive_note(
        &self,
        id: &str,
        expected_revision: i64,
    ) -> Result<NoteRecord, DatabaseError> {
        let now = now_ms();
        let result = sqlx::query("UPDATE notes SET archived_at_ms = ?, updated_at_ms = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND archived_at_ms IS NULL AND deleted_at_ms IS NULL")
            .bind(now).bind(now).bind(id).bind(expected_revision)
            .execute(&self.pool).await.map_err(DatabaseError::Query)?;
        if result.rows_affected() == 0 {
            return Err(self.mutation_error(id, expected_revision).await?);
        }
        self.note_by_id(id).await
    }

    pub async fn unarchive_note(
        &self,
        id: &str,
        expected_revision: i64,
    ) -> Result<NoteRecord, DatabaseError> {
        let now = now_ms();
        let sort_key = format!("{:020}-{id}", i64::MAX - now);
        let result = sqlx::query("UPDATE notes SET archived_at_ms = NULL, sort_key = ?, updated_at_ms = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND archived_at_ms IS NOT NULL AND deleted_at_ms IS NULL")
            .bind(sort_key).bind(now).bind(id).bind(expected_revision)
            .execute(&self.pool).await.map_err(DatabaseError::Query)?;
        if result.rows_affected() == 0 {
            return Err(self.mutation_error(id, expected_revision).await?);
        }
        self.note_by_id(id).await
    }

    pub async fn restore_deleted_note(
        &self,
        id: &str,
        expected_revision: i64,
    ) -> Result<NoteRecord, DatabaseError> {
        let result = sqlx::query("UPDATE notes SET deleted_at_ms = NULL, updated_at_ms = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at_ms IS NOT NULL")
            .bind(now_ms()).bind(id).bind(expected_revision)
            .execute(&self.pool).await.map_err(DatabaseError::Query)?;
        if result.rows_affected() == 0 {
            return Err(self.mutation_error(id, expected_revision).await?);
        }
        self.note_by_id(id).await
    }

    pub async fn delete_note(
        &self,
        id: &str,
        expected_revision: i64,
    ) -> Result<NoteRecord, DatabaseError> {
        let now = now_ms();
        let result = sqlx::query("UPDATE notes SET deleted_at_ms = ?, updated_at_ms = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at_ms IS NULL")
            .bind(now).bind(now).bind(id).bind(expected_revision)
            .execute(&self.pool).await.map_err(DatabaseError::Query)?;
        if result.rows_affected() == 0 {
            return Err(self.mutation_error(id, expected_revision).await?);
        }
        self.note_by_id(id).await
    }

    pub async fn permanently_delete_note(
        &self,
        id: &str,
        expected_revision: i64,
    ) -> Result<(), DatabaseError> {
        let result = sqlx::query(
            "DELETE FROM notes WHERE id = ? AND revision = ? AND deleted_at_ms IS NOT NULL",
        )
        .bind(id)
        .bind(expected_revision)
        .execute(&self.pool)
        .await
        .map_err(DatabaseError::Query)?;
        if result.rows_affected() == 0 {
            return Err(self.mutation_error(id, expected_revision).await?);
        }
        Ok(())
    }

    async fn note_by_id(&self, id: &str) -> Result<NoteRecord, DatabaseError> {
        sqlx::query_as::<_, NoteRow>("SELECT id, title, body_ciphertext, color, created_at_ms, updated_at_ms, archived_at_ms, deleted_at_ms, sort_key, text_direction, revision FROM notes WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(DatabaseError::Query)?
            .map(NoteRecord::from)
            .ok_or(DatabaseError::NotFound)
    }

    async fn mutation_error(
        &self,
        id: &str,
        expected: i64,
    ) -> Result<DatabaseError, DatabaseError> {
        let revision = sqlx::query_scalar::<_, i64>("SELECT revision FROM notes WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(DatabaseError::Query)?;
        Ok(match revision {
            None => DatabaseError::NotFound,
            Some(actual) if actual != expected => {
                DatabaseError::RevisionConflict { expected, actual }
            }
            Some(_) => DatabaseError::InvalidState,
        })
    }

    pub async fn purge_expired_deleted_notes(&self, now_ms: i64) -> Result<u64, DatabaseError> {
        const RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
        sqlx::query("DELETE FROM notes WHERE deleted_at_ms IS NOT NULL AND deleted_at_ms <= ?")
            .bind(now_ms - RETENTION_MS)
            .execute(&self.pool)
            .await
            .map(|result| result.rows_affected())
            .map_err(DatabaseError::Query)
    }

    #[cfg(test)]
    async fn in_memory() -> Result<Self, DatabaseError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .map_err(DatabaseError::Connect)?;
        MIGRATOR.run(&pool).await.map_err(DatabaseError::Migrate)?;
        Ok(Self { pool })
    }
}

#[derive(sqlx::FromRow)]
struct NoteRow {
    id: String,
    title: String,
    body_ciphertext: Vec<u8>,
    color: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    archived_at_ms: Option<i64>,
    deleted_at_ms: Option<i64>,
    sort_key: String,
    text_direction: String,
    revision: i64,
}

impl From<NoteRow> for NoteRecord {
    fn from(row: NoteRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            body: String::from_utf8_lossy(&row.body_ciphertext).into_owned(),
            color: row.color,
            created_at_ms: row.created_at_ms,
            updated_at_ms: row.updated_at_ms,
            archived_at_ms: row.archived_at_ms,
            deleted_at_ms: row.deleted_at_ms,
            sort_key: row.sort_key,
            text_direction: row.text_direction,
            revision: row.revision,
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::{Database, DatabaseError};
    use crate::domain::note::{CreateNoteInput, NoteScope, UpdateNoteInput};

    #[tokio::test]
    async fn migrations_create_the_notes_table() {
        let database = Database::in_memory().await.expect("database should open");

        let table: String = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
        )
        .fetch_one(&database.pool)
        .await
        .expect("notes table should exist");

        assert_eq!(table, "notes");
        database
            .health_check()
            .await
            .expect("database should be healthy");
    }

    #[tokio::test]
    async fn settings_round_trip_and_expired_deleted_notes_are_purged() {
        let database = Database::in_memory().await.expect("database should open");
        database
            .save_setting("app", r#"{"closeBehavior":"background"}"#)
            .await
            .expect("setting should save");
        assert_eq!(
            database.setting("app").await.expect("setting should load"),
            Some(r#"{"closeBehavior":"background"}"#.to_string())
        );

        let now_ms = 4_000_000_000_i64;
        let old_deleted_at = now_ms - 31 * 24 * 60 * 60 * 1000;
        sqlx::query(
            "INSERT INTO notes (id, title, title_source, body_ciphertext, body_nonce, body_key_id, color, created_at_ms, updated_at_ms, archived_at_ms, deleted_at_ms, sort_key, text_direction, revision) VALUES ('expired', 'old', 'explicit', X'01', X'02', 'key', 'lemon', 1, 1, NULL, ?, 'a', 'automatic', 1)",
        )
        .bind(old_deleted_at)
        .execute(&database.pool)
        .await
        .expect("fixture should insert");

        assert!(database
            .list_notes(NoteScope::Deleted, "")
            .await
            .expect("expired notes should be queryable safely")
            .is_empty());

        assert_eq!(
            database
                .purge_expired_deleted_notes(now_ms)
                .await
                .expect("purge should succeed"),
            1
        );
    }

    #[tokio::test]
    async fn active_notes_can_be_reordered_atomically_without_revision_changes() {
        let database = Database::in_memory().await.expect("database should open");
        for title in ["First", "Second", "Third"] {
            database
                .create_note(CreateNoteInput {
                    title: title.into(),
                    body: String::new(),
                    color: "lemon".into(),
                    text_direction: "automatic".into(),
                })
                .await
                .expect("note should be created");
        }
        let before = database.list_notes(NoteScope::Active, "").await.unwrap();
        let mut ids: Vec<String> = before.iter().map(|note| note.id.clone()).collect();
        ids.reverse();

        database
            .reorder_active_notes(&ids)
            .await
            .expect("order should save");
        let after = database.list_notes(NoteScope::Active, "").await.unwrap();
        assert_eq!(
            after.iter().map(|note| &note.id).collect::<Vec<_>>(),
            ids.iter().collect::<Vec<_>>()
        );
        assert!(after.iter().all(|note| note.revision == 1));
        assert!(matches!(
            database.reorder_active_notes(&ids[..2]).await,
            Err(DatabaseError::InvalidState)
        ));
    }

    #[tokio::test]
    async fn note_library_lifecycle_and_search_are_revision_safe() {
        let database = Database::in_memory().await.expect("database should open");
        let created = database
            .create_note(CreateNoteInput {
                title: "Product plan".into(),
                body: "Ship the quiet library".into(),
                color: "lemon".into(),
                text_direction: "automatic".into(),
            })
            .await
            .expect("note should be created");

        assert_eq!(
            database
                .list_notes(NoteScope::Active, "QUIET")
                .await
                .unwrap()
                .len(),
            1
        );
        let updated = database
            .update_note(UpdateNoteInput {
                id: created.id.clone(),
                title: "Product plan".into(),
                body: "Ready to ship".into(),
                color: "mint".into(),
                text_direction: "automatic".into(),
                expected_revision: created.revision,
            })
            .await
            .expect("note should update");
        assert_eq!(updated.revision, 2);
        assert!(matches!(
            database.archive_note(&created.id, created.revision).await,
            Err(DatabaseError::RevisionConflict { .. })
        ));

        let archived = database
            .archive_note(&updated.id, updated.revision)
            .await
            .unwrap();
        assert_eq!(
            database
                .list_notes(NoteScope::Active, "")
                .await
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            database
                .list_notes(NoteScope::Archived, "")
                .await
                .unwrap()
                .len(),
            1
        );

        let deleted = database
            .delete_note(&archived.id, archived.revision)
            .await
            .unwrap();
        assert_eq!(
            database
                .list_notes(NoteScope::Archived, "")
                .await
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            database
                .list_notes(NoteScope::Deleted, "")
                .await
                .unwrap()
                .len(),
            1
        );

        let restored = database
            .restore_deleted_note(&deleted.id, deleted.revision)
            .await
            .unwrap();
        assert!(
            restored.archived_at_ms.is_some(),
            "trash restore preserves the previous archive state"
        );
        let active = database
            .unarchive_note(&restored.id, restored.revision)
            .await
            .unwrap();
        let deleted_again = database
            .delete_note(&active.id, active.revision)
            .await
            .unwrap();
        database
            .permanently_delete_note(&deleted_again.id, deleted_again.revision)
            .await
            .unwrap();
        assert!(database
            .list_notes(NoteScope::Deleted, "")
            .await
            .unwrap()
            .is_empty());
    }
}
