use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};
use std::sync::Mutex;

static MINI_POS: Mutex<Option<PhysicalPosition<i32>>> = Mutex::new(None);
static STANDARD_POS: Mutex<Option<PhysicalPosition<i32>>> = Mutex::new(None);

fn get_main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
        .ok_or_else(|| "未找到主窗口".to_string())
}

#[tauri::command]
pub fn window_monitor_visible(app: AppHandle) -> Result<bool, String> {
    let window = get_main_window(&app)?;
    Ok(window.is_visible().map_err(|e| e.to_string())?
        && !window.is_minimized().map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) -> Result<(), String> {
    let window = get_main_window(&app)?;
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_start_dragging(app: AppHandle) -> Result<(), String> {
    let window = get_main_window(&app)?;
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_toggle_maximize(app: AppHandle) -> Result<bool, String> {
    let window = get_main_window(&app)?;
    let is_max = window.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub fn window_is_maximized(app: AppHandle) -> Result<bool, String> {
    let window = get_main_window(&app)?;
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_close(app: AppHandle) -> Result<(), String> {
    let window = get_main_window(&app)?;
    if window.label() == "main" {
        let settings = crate::commands::settings::get_general_settings().unwrap_or_default();
        match settings.close_action.as_str() {
            "minimize" => {
                window.hide().map_err(|e| e.to_string())
            }
            "exit" => {
                crate::shutdown::request(&app, 0);
                Ok(())
            }
            _ => {
                // "ask": 同时通过全局 App 级别与当前窗口级别广播事件，确保前端 100% 能够收到
                use tauri::Emitter;
                let _ = app.emit("request-close-action", ());
                let _ = window.emit("request-close-action", ());
                Ok(())
            }
        }
    } else {
        window.close().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn window_set_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
    let window = get_main_window(&app)?;
    window.set_always_on_top(always_on_top).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_set_form_factor(app: AppHandle, factor: String) -> Result<(), String> {
    let window = get_main_window(&app)?;
    match factor.as_str() {
        "mini" => {
            // 1. 记录大窗口退出前坐标
            if let Ok(pos) = window.outer_position() {
                if let Ok(mut lock) = STANDARD_POS.lock() {
                    *lock = Some(pos);
                }
            }
            // 2. 解除最大化并设置挂件推荐尺寸 (380x580)
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            }
            window.set_size(LogicalSize::new(380.0, 580.0)).map_err(|e| e.to_string())?;
            // 3. 若有上次挂件位置，恢复至该坐标 (副屏或桌面角落)
            if let Ok(lock) = MINI_POS.lock() {
                if let Some(pos) = *lock {
                    let _ = window.set_position(pos);
                }
            }
        }
        "compact" => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            }
            window.set_size(LogicalSize::new(1024.0, 680.0)).map_err(|e| e.to_string())?;
        }
        "standard" => {
            // 1. 记录挂件退出前坐标
            if let Ok(pos) = window.outer_position() {
                if let Ok(mut lock) = MINI_POS.lock() {
                    *lock = Some(pos);
                }
            }
            // 2. 还原大窗口推荐尺寸 (1160x740)
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            }
            window.set_size(LogicalSize::new(1160.0, 740.0)).map_err(|e| e.to_string())?;
            // 3. 恢复大窗口坐标
            if let Ok(lock) = STANDARD_POS.lock() {
                if let Some(pos) = *lock {
                    let _ = window.set_position(pos);
                }
            }
        }
        "full" => {
            if !window.is_maximized().unwrap_or(false) {
                let _ = window.maximize();
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn window_execute_close(app: AppHandle, action: String, remember: Option<bool>) -> Result<(), String> {
    if remember.unwrap_or(false) && (action == "minimize" || action == "exit") {
        let _ = crate::commands::settings::update_persisted_close_action(&action);
    }
    let window = get_main_window(&app)?;
    if action == "minimize" {
        window.hide().map_err(|e| e.to_string())
    } else {
        crate::shutdown::request(&app, 0);
        Ok(())
    }
}
