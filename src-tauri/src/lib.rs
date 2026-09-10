mod app;
mod commands;
mod domain;
mod infrastructure;
#[cfg(target_os = "macos")]
mod macos_dock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}
