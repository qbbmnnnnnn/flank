use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteScope {
    Active,
    Archived,
    Deleted,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotesQuery {
    pub scope: NoteScope,
    #[serde(default)]
    pub query: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteInput {
    pub title: String,
    pub body: String,
    pub color: String,
    #[serde(default = "default_text_direction")]
    pub text_direction: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteInput {
    pub id: String,
    pub title: String,
    pub body: String,
    pub color: String,
    pub text_direction: String,
    pub expected_revision: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMutationInput {
    pub id: String,
    pub expected_revision: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecord {
    pub id: String,
    pub title: String,
    pub body: String,
    pub color: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub archived_at_ms: Option<i64>,
    pub deleted_at_ms: Option<i64>,
    pub sort_key: String,
    pub text_direction: String,
    pub revision: i64,
}

pub fn default_text_direction() -> String {
    "automatic".into()
}
