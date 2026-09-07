use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

use crate::infrastructure::sqlite::{Database, DatabaseError};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub language: String,
    pub theme: String,
    pub launch_at_login: bool,
    pub close_behavior: String,
    pub dock_enabled: bool,
    pub dock_visible_count: u8,
    pub dock_side: String,
    pub vertical_position: u8,
    pub dock_size: String,
    pub hover_animation: bool,
    pub action_delay: f32,
    pub fullscreen_behavior: String,
    pub display_preference: String,
    pub font: String,
    pub font_size: u8,
    pub text_direction: String,
    pub markdown: bool,
    pub default_color: String,
    pub automatic_updates: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "zh-CN".into(),
            theme: "system".into(),
            launch_at_login: false,
            close_behavior: "background".into(),
            dock_enabled: true,
            dock_visible_count: 5,
            dock_side: "right".into(),
            vertical_position: 50,
            dock_size: "medium".into(),
            hover_animation: true,
            action_delay: 1.0,
            fullscreen_behavior: "hide".into(),
            display_preference: "cursor".into(),
            font: "system".into(),
            font_size: 16,
            text_direction: "automatic".into(),
            markdown: true,
            default_color: "random".into(),
            automatic_updates: true,
        }
    }
}

pub struct AppState {
    pub database: Database,
    pub settings: RwLock<AppSettings>,
    pub settings_save_lock: tauri::async_runtime::Mutex<()>,
}

fn show_main(app: &tauri::AppHandle, route: Option<&str>) {
    if let Some(route) = route {
        let _ = app.emit_to("main", "main:navigate", route);
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

fn toggle_dock(app: &tauri::AppHandle) {
    if let Some(dock) = app.get_webview_window("dock") {
        if dock.is_visible().unwrap_or(false) {
            let _ = app.emit_to("dock", "dock:hidden", ());
            let _ = dock.hide();
            if let Some(panel) = app.get_webview_window("dock-panel") {
                let _ = panel.hide();
            }
        } else {
            let _ = dock.show();
        }
    }
}

fn create_note_from_status_entry(app: &tauri::AppHandle) {
    if let Some(dock) = app.get_webview_window("dock") {
        let _ = dock.show();
        let _ = app.emit_to("dock", "dock:create-note", ());
    }
}

fn status_menu(app: &tauri::AppHandle, language: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let labels = match language {
        "en-US" => ["Open main window", "Show / hide Dock", "New note", "Quit FLANK"],
        _ => ["打开主窗口", "显示 / 隐藏便签栏", "新建便签", "退出 FLANK"],
    };
    let open = MenuItemBuilder::with_id("open-main", labels[0]).build(app)?;
    let dock = MenuItemBuilder::with_id("toggle-dock", labels[1]).build(app)?;
    let new_note = MenuItemBuilder::with_id("new-note", labels[2]).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", labels[3]).build(app)?;
    MenuBuilder::new(app).items(&[&open, &dock, &new_note, &quit]).build()
}

pub fn update_status_language(app: &tauri::AppHandle, language: &str) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("flank-status"), status_menu(app, language)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn install_status_entry(app: &mut tauri::App) -> tauri::Result<()> {
    let language = app.state::<AppState>().settings.read().expect("settings lock poisoned").language.clone();
    let menu = status_menu(app.handle(), &language)?;

    let mut tray = TrayIconBuilder::with_id("flank-status")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Flank")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle(), Some("/"));
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-main" => show_main(app, Some("/")),
            "toggle-dock" => toggle_dock(app),
            "new-note" => create_note_from_status_entry(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let database = tauri::async_runtime::block_on(Database::open(&app_data_dir))
                .map_err(|error: DatabaseError| Box::<dyn std::error::Error>::from(error))?;
            let mut settings = tauri::async_runtime::block_on(database.setting("app"))?
                .and_then(|value| serde_json::from_str::<AppSettings>(&value).ok())
                .unwrap_or_default();
            if !["zh-CN", "en-US"].contains(&settings.language.as_str()) { settings.language = "zh-CN".into(); }
            if !["system", "light", "dark"].contains(&settings.theme.as_str()) { settings.theme = "system".into(); }
            if !["background", "quit"].contains(&settings.close_behavior.as_str()) { settings.close_behavior = "background".into(); }
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            let _ = tauri::async_runtime::block_on(database.purge_expired_deleted_notes(now_ms));

            app.manage(AppState {
                database,
                settings: RwLock::new(settings.clone()),
                settings_save_lock: tauri::async_runtime::Mutex::new(()),
            });
            install_status_entry(app)?;
            // Reapply the persisted login preference, independently of opening Settings.
            let autostart = if settings.launch_at_login { app.autolaunch().enable() } else { app.autolaunch().disable() };
            if let Err(error) = autostart { eprintln!("Could not restore login startup: {error}"); }

            // Keep the compact Dock flush with the primary screen edge on first launch.
            if let Some(dock) = app.get_webview_window("dock") {
                if let Some(monitor) = dock.primary_monitor()? {
                    let screen_position = monitor.position();
                    let screen_size = monitor.size();
                    let dock_size = dock.outer_size()?;
                    let x = if settings.dock_side == "left" { screen_position.x } else {
                        screen_position.x + screen_size.width as i32 - dock_size.width as i32
                    };
                    let y = screen_position.y
                        + ((screen_size.height.saturating_sub(dock_size.height)) / 2) as i32;
                    dock.set_position(tauri::PhysicalPosition::new(x, y))?;
                }
                if settings.dock_enabled {
                    dock.show()?;
                }
            }

            if std::env::args().any(|argument| argument == "--background") {
                if let Some(main) = app.get_webview_window("main") {
                    main.hide()?;
                }
            }

            if let Some(main) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // The frontend drains its settings queue before invoking close_main_window.
                        // This also covers Alt+F4, not just the custom titlebar close button.
                        api.prevent_close();
                        let _ = app_handle.emit_to("main", "main:close-requested", ());
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::commands::notes::list_notes,
            crate::commands::notes::create_note,
            crate::commands::notes::update_note,
            crate::commands::notes::archive_note,
            crate::commands::notes::unarchive_note,
            crate::commands::notes::delete_note,
            crate::commands::notes::restore_deleted_note,
            crate::commands::notes::permanently_delete_note,
            crate::commands::system::get_app_info,
            crate::commands::system::get_settings,
            crate::commands::system::frontend_ready,
            crate::commands::system::close_main_window,
            crate::commands::system::save_settings,
            crate::commands::system::show_main_window,
            crate::commands::system::toggle_dock_window,
            crate::commands::system::sample_screen_luminance,
            crate::commands::system::is_primary_mouse_button_pressed,
            crate::commands::system::show_dock_panel,
            crate::commands::system::settle_dock_panel,
            crate::commands::system::prepare_dock_panel_animation,
            crate::commands::system::hide_dock_panel,
            crate::commands::system::show_main_notification
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Flank");
}
