use serde::Serialize;
use tauri::State;

use crate::{app::AppState, domain::error::AppError};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    database_ready: bool,
}

#[tauri::command]
pub async fn get_app_info(state: State<'_, AppState>) -> Result<AppInfo, AppError> {
    state.database.health_check().await?;

    Ok(AppInfo {
        name: "Flank",
        version: env!("CARGO_PKG_VERSION"),
        database_ready: true,
    })
}
