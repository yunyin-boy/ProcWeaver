use super::{process, settings};
use serde::Serialize;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub(crate) use windows::{confirm, ready};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunStatus {
    supported: bool,
    configured: bool,
    running: bool,
    effective: Option<bool>,
    auto_route: Option<bool>,
    detail: Option<String>,
    configured_mode: &'static str,
    active_mode: Option<&'static str>,
}

#[tauri::command]
pub async fn get_tun_status(
    state: tauri::State<'_, process::CoreStateMutex>,
) -> Result<TunStatus, String> {
    let _lifecycle = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    let settings = settings::get_general_settings()?;
    let core = process::read_core_status(&state)?;
    let configured_mode = settings.capture_mode();
    let status = TunStatus {
        supported: cfg!(windows),
        configured: configured_mode == "tun",
        running: core.running,
        effective: None,
        auto_route: None,
        detail: core.last_start_error,
        configured_mode,
        active_mode: None,
    };
    #[cfg(windows)]
    if core.running {
        let mut status = windows::observe(status, core.controller_port).await;
        status.active_mode = if status.effective == Some(true) {
            Some("tun")
        } else if status.effective == Some(false) && status.detail.is_none() {
            match configured_mode {
                "user_mode" if crate::capture::user_mode::hook_assets_ready() => Some("user_mode"),
                "user_mode" => {
                    status.detail = Some("用户态 Hook 组件未就绪".into());
                    None
                }
                "windivert_v1" => {
                    use crate::capture::windivert::session;
                    if session::stats().active && session::error().is_none() {
                        Some("windivert_v1")
                    } else {
                        status.detail = session::error().or_else(|| Some("WinDivert 尚未就绪".into()));
                        None
                    }
                }
                "app_proxy" => Some("app_proxy"),
                _ => None,
            }
        } else {
            None
        };
        return Ok(status);
    }
    #[cfg(not(windows))]
    if core.running {
        return Ok(TunStatus { active_mode: Some("app_proxy"), ..status });
    }
    Ok(status)
}
