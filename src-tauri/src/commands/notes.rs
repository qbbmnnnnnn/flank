use tauri::State;

use crate::{
    app::AppState,
    domain::{
        error::AppError,
        note::{CreateNoteInput, ListNotesQuery, NoteMutationInput, NoteRecord, UpdateNoteInput},
    },
};

const COLORS: [&str; 6] = ["lemon", "peach", "rose", "lilac", "sky", "mint"];
const DIRECTIONS: [&str; 3] = ["automatic", "ltr", "rtl"];

/// Accepts the six built-in colors plus user colors added from the settings pool.
fn is_valid_color(color: &str) -> bool {
    COLORS.contains(&color)
        || (color.starts_with("custom-")
            && color.len() <= 40
            && color.chars().all(|character| character.is_ascii_alphanumeric() || character == '-'))
}

fn validate_note(title: &str, body: &str, color: &str, direction: &str) -> Result<(), AppError> {
    if title.chars().count() > 200 {
        return Err(AppError::validation("标题不能超过 200 个字符"));
    }
    if body.len() > 2 * 1024 * 1024 {
        return Err(AppError::validation("便签内容不能超过 2 MB"));
    }
    if !is_valid_color(color) {
        return Err(AppError::validation("不支持的便签颜色"));
    }
    if !DIRECTIONS.contains(&direction) {
        return Err(AppError::validation("不支持的文字方向"));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_notes(
    state: State<'_, AppState>,
    query: ListNotesQuery,
) -> Result<Vec<NoteRecord>, AppError> {
    state
        .database
        .list_notes(query.scope, &query.query)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn create_note(
    state: State<'_, AppState>,
    input: CreateNoteInput,
) -> Result<NoteRecord, AppError> {
    validate_note(
        &input.title,
        &input.body,
        &input.color,
        &input.text_direction,
    )?;
    state.database.create_note(input).await.map_err(Into::into)
}

#[tauri::command]
pub async fn update_note(
    state: State<'_, AppState>,
    input: UpdateNoteInput,
) -> Result<NoteRecord, AppError> {
    validate_note(
        &input.title,
        &input.body,
        &input.color,
        &input.text_direction,
    )?;
    state.database.update_note(input).await.map_err(Into::into)
}

#[tauri::command]
pub async fn archive_note(
    state: State<'_, AppState>,
    input: NoteMutationInput,
) -> Result<NoteRecord, AppError> {
    state
        .database
        .archive_note(&input.id, input.expected_revision)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn unarchive_note(
    state: State<'_, AppState>,
    input: NoteMutationInput,
) -> Result<NoteRecord, AppError> {
    state
        .database
        .unarchive_note(&input.id, input.expected_revision)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_note(
    state: State<'_, AppState>,
    input: NoteMutationInput,
) -> Result<NoteRecord, AppError> {
    state
        .database
        .delete_note(&input.id, input.expected_revision)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn restore_deleted_note(
    state: State<'_, AppState>,
    input: NoteMutationInput,
) -> Result<NoteRecord, AppError> {
    state
        .database
        .restore_deleted_note(&input.id, input.expected_revision)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn permanently_delete_note(
    state: State<'_, AppState>,
    input: NoteMutationInput,
) -> Result<(), AppError> {
    state
        .database
        .permanently_delete_note(&input.id, input.expected_revision)
        .await
        .map_err(Into::into)
}
