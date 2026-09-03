use std::{path::Path, time::Duration};

use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    ConnectOptions, SqlitePool,
};
use thiserror::Error;

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

#[cfg(test)]
mod tests {
    use super::Database;

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
}
