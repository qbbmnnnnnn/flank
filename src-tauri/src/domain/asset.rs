use serde::Serialize;

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AssetRecord {
    pub id: String,
    pub content_hash: String,
    pub relative_path: String,
    pub original_name: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub sync_state: String,
    pub created_at_ms: i64,
}
