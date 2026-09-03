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
        Self {
            code: "database_error",
            message: error.to_string(),
            retryable: true,
        }
    }
}
