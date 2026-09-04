use serde::Serialize;

use crate::infrastructure::sqlite::DatabaseError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl From<DatabaseError> for AppError {
    fn from(error: DatabaseError) -> Self {
        let (code, retryable) = match &error {
            DatabaseError::NotFound => ("note_not_found", false),
            DatabaseError::RevisionConflict { .. } => ("revision_conflict", true),
            DatabaseError::InvalidState => ("invalid_note_state", false),
            _ => ("database_error", true),
        };
        Self {
            code,
            message: error.to_string(),
            retryable,
        }
    }
}

impl AppError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            code: "validation_error",
            message: message.into(),
            retryable: false,
        }
    }
}
