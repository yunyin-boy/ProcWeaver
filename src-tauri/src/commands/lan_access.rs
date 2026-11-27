use super::{process, settings};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanAccessStatus {
    configured: bool,
    running: bool,
    effective: Option<bool>,
}

#[tauri::command]
pub async fn get_lan_access_status(
    state: tauri::State<'_, process::CoreStateMutex>,
) -> Result<LanAccessStatus, String> {
    let _lifecycle = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    let configured = settings::get_general_settings()?.allow_lan;
    let core = process::read_core_status(&state)?;
    #[cfg(windows)]
    let effective = match core.pid {
        Some(pid) => mixed_lan_listener(core.mixed_port, pid)?,
        None => None,
    };
    #[cfg(not(windows))]
    let effective = if core.running {
        controller_setting(core.controller_port).await.ok()
    } else {
        None
    };
    Ok(LanAccessStatus { configured, running: core.running, effective })
}

#[cfg(not(windows))]
async fn controller_setting(port: u16) -> Result<bool, String> {
    let client = super::mihomo_api::controller_client()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|_| "无法连接核心")?;
    let configs: serde_json::Value = client
        .get(format!("http://127.0.0.1:{port}/configs"))
        .send().await.map_err(|_| "无法读取核心状态")?
        .error_for_status().map_err(|_| "无法读取核心状态")?
        .json().await.map_err(|_| "核心状态无效")?;
    configs["allow-lan"].as_bool().ok_or_else(|| "核心局域网状态无效".into())
}

#[cfg(windows)]
fn mixed_lan_listener(port: u16, pid: u32) -> Result<Option<bool>, String> {
    let mut loopback = false;
    for (address, owner) in super::dns_runtime::listener_owners(true)? {
        if owner != pid || address.port() != port {
            continue;
        }
        if !address.ip().to_canonical().is_loopback() {
            return Ok(Some(true));
        }
        loopback = true;
    }
    Ok(loopback.then_some(false))
}

#[cfg(windows)]
pub(crate) async fn confirm(port: u16, pid: u32, allow_lan: bool) -> Result<(), String> {
    use std::time::Duration;
    for _ in 0..6 {
        if mixed_lan_listener(port, pid)? == Some(allow_lan)
            && tokio::time::timeout(
                Duration::from_millis(200),
                tokio::net::TcpStream::connect(("127.0.0.1", port)),
            ).await.is_ok_and(|result| result.is_ok())
        {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(75)).await;
    }
    let expected = if allow_lan { "同时监听本机与局域网" } else { "只监听本机" };
    Err(format!("混合端口 {port} 未确认{expected}，请检查当前配置的 bind-address 和端口占用"))
}

#[cfg(windows)]
pub(crate) async fn confirm_config(config: &serde_yaml::Value, pid: u32) -> Result<(), String> {
    let port = config["mixed-port"].as_u64()
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port != 0)
        .ok_or("运行配置缺少有效的混合端口")?;
    confirm(port, pid, config["allow-lan"].as_bool().unwrap_or(false)).await
}

#[cfg(windows)]
pub(super) async fn apply() -> Result<(), String> {
    let routing = crate::routing_overrides::read()?;
    let (profile_id, path) = crate::routing_overrides::current_source();
    let raw = std::fs::read_to_string(path).map_err(|_| "读取当前配置失败")?;
    let prepared = crate::routing_overrides::prepare(&raw, &routing, &profile_id)?;
    let prepared = tokio::task::spawn_blocking(move || {
        super::profile::validate_config(&prepared)?;
        Ok::<_, String>(prepared)
    }).await.map_err(|_| "配置校验任务失败")??;
    crate::routing_overrides::apply_lan_runtime(&prepared).await?;
    let generation = crate::routing_overrides::tracker::status(&routing).generation;
    crate::routing_overrides::set_applied(routing.revision, generation);
    Ok(())
}
