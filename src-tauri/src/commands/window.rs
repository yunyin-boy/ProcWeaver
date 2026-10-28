use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

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
                // "ask"
                let _ = window.emit("request-close-action", ());
                Ok(())
            }
        }
    } else {
        window.close().map_err(|e| e.to_string())
    }
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
