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

            // Keep the compact Dock flush with the primary screen edge on first launch.
            // Later moves are handled by the Dock window and persisted per monitor.
            if let Some(dock) = app.get_webview_window("dock") {
                if let Some(monitor) = dock.primary_monitor()? {
                    let screen_position = monitor.position();
                    let screen_size = monitor.size();
                    let dock_size = dock.outer_size()?;
                    let x = screen_position.x + screen_size.width as i32 - dock_size.width as i32;
                    let y = screen_position.y
                        + ((screen_size.height.saturating_sub(dock_size.height)) / 2) as i32;
                    dock.set_position(tauri::PhysicalPosition::new(x, y))?;
                }
            }

            // The settings window is the application's main page. Closing it
            // exits the process so the always-on-top Dock cannot remain orphaned.
            if let Some(main) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        app_handle.exit(0);
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::commands::system::get_app_info,
            crate::commands::system::sample_screen_luminance,
            crate::commands::system::is_primary_mouse_button_pressed,
            crate::commands::system::show_dock_panel,
            crate::commands::system::settle_dock_panel,
            crate::commands::system::prepare_dock_panel_animation,
            crate::commands::system::hide_dock_panel,
            crate::commands::system::show_dock_toast
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Noty");
}
