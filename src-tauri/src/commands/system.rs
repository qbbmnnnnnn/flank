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
pub fn show_dock_panel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    anchor_side: String,
) -> Result<(), String> {
    use tauri::Manager;

    let panel = app
        .get_webview_window("dock-panel")
        .ok_or_else(|| "dock panel window is unavailable".to_string())?;
    let panel_was_visible = panel.is_visible().map_err(|error| error.to_string())?;
    let rail_position = window.outer_position().map_err(|error| error.to_string())?;
    let panel_size = panel.outer_size().map_err(|error| error.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "current monitor is unavailable".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let staged_width = (536.0 * monitor.scale_factor()).round() as u32;

    // The temporary wide window reaches the physical screen edge, allowing
    // the paper to enter from behind the Dock and stop beside it.
    let x = if anchor_side == "left" {
        monitor_position.x
    } else {
        monitor_position.x + monitor_size.width as i32 - staged_width as i32
    };
    if panel_size.width != staged_width {
        panel
            .set_size(tauri::PhysicalSize::new(staged_width, panel_size.height))
            .map_err(|error| error.to_string())?;
    }
    let target_position = tauri::PhysicalPosition::new(x, rail_position.y);
    if panel.outer_position().map_err(|error| error.to_string())? != target_position {
        panel
            .set_position(target_position)
            .map_err(|error| error.to_string())?;
    }
    set_panel_dock_passthrough(&panel, &anchor_side, false)?;
    enforce_frameless_panel(&panel)?;
    if !panel_was_visible {
        panel.show().map_err(|error| error.to_string())?;
    }
    panel.set_focus().map_err(|error| error.to_string())?;
    enforce_frameless_panel(&panel)?;
    // Keep the Dock above the temporarily overlapping animation window so its
    // hover and click targets work from the very first animation frame.
    raise_window_without_focus(&window)
}

#[tauri::command]
pub fn settle_dock_panel(app: tauri::AppHandle, anchor_side: String) -> Result<(), String> {
    use tauri::Manager;

    let panel = app
        .get_webview_window("dock-panel")
        .ok_or_else(|| "dock panel window is unavailable".to_string())?;
    set_panel_dock_passthrough(&panel, &anchor_side, true)
}

#[tauri::command]
pub fn prepare_dock_panel_animation(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let panel = app
        .get_webview_window("dock-panel")
        .ok_or_else(|| "dock panel window is unavailable".to_string())?;
    set_panel_dock_passthrough(&panel, "right", false)
}

#[tauri::command]
pub fn hide_dock_panel(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if let Some(panel) = app.get_webview_window("dock-panel") {
        panel.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
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


#[cfg(target_os = "windows")]
fn raise_window_without_focus(window: &tauri::WebviewWindow) -> Result<(), String> {
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

    const HWND_TOPMOST: Hwnd = -1isize as Hwnd;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    let result = unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
        )
    };
    if result == 0 {
        Err("failed to raise dock above panel".to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn raise_window_without_focus(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn enforce_frameless_panel(panel: &tauri::WebviewWindow) -> Result<(), String> {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetWindowLongPtrW(window: Hwnd, index: i32) -> isize;
        fn SetWindowLongPtrW(window: Hwnd, index: i32, value: isize) -> isize;
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

    const GWL_STYLE: i32 = -16;
    const WS_BORDER: isize = 0x0080_0000;
    const WS_DLGFRAME: isize = 0x0040_0000;
    const WS_THICKFRAME: isize = 0x0004_0000;
    const WS_SYSMENU: isize = 0x0008_0000;
    const WS_MINIMIZEBOX: isize = 0x0002_0000;
    const WS_MAXIMIZEBOX: isize = 0x0001_0000;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;

    let hwnd = panel.hwnd().map_err(|error| error.to_string())?.0;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let frameless_style = style
            & !(WS_BORDER | WS_DLGFRAME | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
        if frameless_style != style {
            SetWindowLongPtrW(hwnd, GWL_STYLE, frameless_style);
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
    hide_native_window_border(panel)
}

#[cfg(not(target_os = "windows"))]
fn enforce_frameless_panel(panel: &tauri::WebviewWindow) -> Result<(), String> {
    hide_native_window_border(panel)
}

#[cfg(target_os = "windows")]
fn hide_native_window_border(panel: &tauri::WebviewWindow) -> Result<(), String> {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(
            window: Hwnd,
            attribute: u32,
            value: *const c_void,
            value_size: u32,
        ) -> i32;
    }

    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;
    let hwnd = panel.hwnd().map_err(|error| error.to_string())?.0;
    unsafe {
        // Older Windows versions may not support DWMWA_BORDER_COLOR. The
        // undecorated fallback remains valid, so this is intentionally best-effort.
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &DWMWA_COLOR_NONE as *const u32 as *const c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn hide_native_window_border(_panel: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_panel_dock_passthrough(
    panel: &tauri::WebviewWindow,
    anchor_side: &str,
    enabled: bool,
) -> Result<(), String> {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;
    type Hrgn = *mut c_void;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowRgn(window: Hwnd, region: Hrgn, redraw: i32) -> i32;
    }

    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> Hrgn;
        fn DeleteObject(object: Hrgn) -> i32;
    }

    let hwnd = panel.hwnd().map_err(|error| error.to_string())?.0;
    let size = panel.outer_size().map_err(|error| error.to_string())?;
    let scale_factor = panel.scale_factor().map_err(|error| error.to_string())?;
    let clearance = (104.0 * scale_factor).round() as i32;
    let top_chrome_guard = (32.0 * scale_factor).round() as i32;
    let width = size.width as i32;
    let height = size.height as i32;
    let (left, right) = if !enabled {
        // Keep an explicit full-size region instead of restoring the system's
        // default region. Restoring it while the window is visible can expose
        // a one-frame Windows caption and opaque background during note swaps.
        (0, width)
    } else if anchor_side == "left" {
        (clearance, width)
    } else {
        (0, width - clearance)
    };

    unsafe {
        // The panel content is vertically centered, so excluding this unused
        // top strip is invisible to the UI while making it impossible for a
        // transient Windows caption to be painted during note switches.
        let region = CreateRectRgn(left, top_chrome_guard, right, height);
        if region.is_null() {
            return Err("failed to create dock panel hit region".to_string());
        }
        if SetWindowRgn(hwnd, region, 1) == 0 {
            DeleteObject(region);
            return Err("failed to apply dock panel hit region".to_string());
        }
    }
    // Region changes trigger a non-client repaint on Windows. Strip any
    // caption styles WebView2 exposed and suppress the remaining DWM border.
    enforce_frameless_panel(panel)
}

#[cfg(not(target_os = "windows"))]
fn set_panel_dock_passthrough(
    _panel: &tauri::WebviewWindow,
    _anchor_side: &str,
    _enabled: bool,
) -> Result<(), String> {
    Ok(())
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
