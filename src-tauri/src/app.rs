use tauri::Manager;

use crate::infrastructure::sqlite::{Database, DatabaseError};

pub struct AppState {
    pub database: Database,
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let database = tauri::async_runtime::block_on(Database::open(&app_data_dir))
                .map_err(|error: DatabaseError| Box::<dyn std::error::Error>::from(error))?;

            app.manage(AppState { database });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::commands::system::get_app_info
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Flank");
}
