use serde::{Deserialize, Serialize};
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
        name: "Noty",
        version: env!("CARGO_PKG_VERSION"),
        database_ready: true,
    })
}

#[derive(Deserialize)]
pub struct ScreenPoint {
    x: i32,
    y: i32,
}

#[tauri::command]
pub fn sample_screen_luminance(points: Vec<ScreenPoint>) -> Vec<Option<f64>> {
    sample_luminance_impl(&points)
}

#[tauri::command]
pub fn is_primary_mouse_button_pressed() -> bool {
    primary_mouse_button_pressed_impl()
}

#[tauri::command]
pub fn resize_dock_window(
    window: tauri::WebviewWindow,
    logical_width: f64,
    anchor_right: bool,
) -> Result<(), String> {
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let width = (logical_width * scale_factor).round().max(1.0) as u32;
    set_dock_window_extent(&window, width, anchor_right)
}

#[cfg(target_os = "windows")]
fn set_dock_window_extent(
    window: &tauri::WebviewWindow,
    width: u32,
    anchor_right: bool,
) -> Result<(), String> {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowPos(
            window: Hwnd,
            insert_after: Hwnd,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }

    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;

    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let x = if anchor_right {
        position.x + size.width as i32 - width as i32
    } else {
        position.x
    };
    let updated = unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            x,
            position.y,
            width as i32,
            size.height as i32,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
    if updated == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn show_dock_toast(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    message: String,
) -> Result<(), String> {
    use tauri::{Emitter, Manager};

    let toast = app
        .get_webview_window("dock-toast")
        .ok_or_else(|| "dock toast window is unavailable".to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "current monitor is unavailable".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let toast_size = toast.outer_size().map_err(|error| error.to_string())?;
    let scale_factor = monitor.scale_factor();
    let x = monitor_position.x + (monitor_size.width.saturating_sub(toast_size.width) / 2) as i32;
    let y = monitor_position.y
        + monitor_size.height.saturating_sub(toast_size.height) as i32
        - (28.0 * scale_factor).round() as i32;

    toast
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    toast.set_ignore_cursor_events(true).map_err(|error| error.to_string())?;
    toast.show().map_err(|error| error.to_string())?;
    toast.emit("dock-toast", message).map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
fn set_dock_window_extent(
    window: &tauri::WebviewWindow,
    width: u32,
    anchor_right: bool,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let x = if anchor_right {
        position.x + size.width as i32 - width as i32
    } else {
        position.x
    };
    window
        .set_position(tauri::PhysicalPosition::new(x, position.y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(width, size.height))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn primary_mouse_button_pressed_impl() -> bool {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetAsyncKeyState(virtual_key: i32) -> i16;
    }

    const VK_LBUTTON: i32 = 0x01;
    unsafe { GetAsyncKeyState(VK_LBUTTON) < 0 }
}

#[cfg(not(target_os = "windows"))]
fn primary_mouse_button_pressed_impl() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn sample_luminance_impl(points: &[ScreenPoint]) -> Vec<Option<f64>> {
    use std::ffi::c_void;

    type Hdc = *mut c_void;
    type Hwnd = *mut c_void;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetDC(window: Hwnd) -> Hdc;
        fn ReleaseDC(window: Hwnd, dc: Hdc) -> i32;
    }

    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn GetPixel(dc: Hdc, x: i32, y: i32) -> u32;
    }

    fn linear_channel(value: u8) -> f64 {
        let channel = f64::from(value) / 255.0;
        if channel <= 0.04045 {
            channel / 12.92
        } else {
            ((channel + 0.055) / 1.055).powf(2.4)
        }
    }

    // Sampling is intentionally taken beside the translucent controls, so the
    // returned color represents the desktop/application below the Dock window.
    unsafe {
        let dc = GetDC(std::ptr::null_mut());
        if dc.is_null() {
            return vec![None; points.len()];
        }
        let result = points
            .iter()
            .map(|point| {
                let color = GetPixel(dc, point.x, point.y);
                if color == u32::MAX {
                    return None;
                }
                let red = (color & 0xff) as u8;
                let green = ((color >> 8) & 0xff) as u8;
                let blue = ((color >> 16) & 0xff) as u8;
                Some(
                    0.2126 * linear_channel(red)
                        + 0.7152 * linear_channel(green)
                        + 0.0722 * linear_channel(blue),
                )
            })
            .collect();
        ReleaseDC(std::ptr::null_mut(), dc);
        result
    }
}

#[cfg(not(target_os = "windows"))]
fn sample_luminance_impl(points: &[ScreenPoint]) -> Vec<Option<f64>> {
    vec![None; points.len()]
}
