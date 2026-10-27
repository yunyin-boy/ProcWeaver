use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(windows)]
mod native;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static ADAPTER_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DnsAdapterRecovery {
    pub interface_alias: String,
    pub was_dhcp: bool,
    pub static_dns: Vec<String>,
    #[serde(default)]
    pub windivert_mode: bool,
    #[serde(default)]
    pub origin: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DnsGuardInfo {
    pub enabled: bool,
    pub origin: String,
    pub windivert_mode: bool,
}

pub fn is_windivert_dns_guard_active() -> bool {
    let Ok(bytes) = std::fs::read(recovery_path()) else {
        return false;
    };
    serde_json::from_slice::<DnsAdapterRecovery>(&bytes)
        .map(|r| r.windivert_mode)
        .unwrap_or(false)
}

pub fn requires_port_53_guard() -> Result<bool, String> {
    let path = recovery_path();
    if !path.exists() {
        return Ok(false);
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let record: DnsAdapterRecovery = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    Ok(!record.windivert_mode)
}

fn recovery_path() -> PathBuf {
    crate::storage::data_dir().join("config/dns-adapter-recovery.json")
}

/// 执行隐藏窗口的异步命令行工具，具备有界超时防护 (C01)
#[cfg(windows)]
async fn run_hidden_cmd_async(program: &str, args: &[&str], timeout_secs: u64) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.kill_on_drop(true);

    let output_future = cmd.output();
    let res = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), output_future)
        .await
        .map_err(|_| format!("执行命令 [{}] 超时 ({}秒)，已终止等待", program, timeout_secs))?
        .map_err(|e| format!("执行命令 [{}] 失败: {}", program, e))?;

    let stdout = String::from_utf8_lossy(&res.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&res.stderr).trim().to_string();
    if !res.status.success() {
        return Err(format!("命令 [{}] 执行返回错误（{}）: {}", program, res.status, if stderr.is_empty() { &stdout } else { &stderr }));
    }
    Ok(stdout)
}

#[cfg(not(windows))]
async fn run_hidden_cmd_async(_program: &str, _args: &[&str], _timeout_secs: u64) -> Result<String, String> {
    Ok(String::new())
}

/// 异步获取当前连接互联网的主要网络适配器名称（如 "以太网" 或 "WLAN"）
pub async fn get_active_interface_alias() -> Result<String, String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(|| native::read(None).map(|value| value.alias)).await.map_err(|_| "读取网卡任务失败")?
    }
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows 系统".into())
    }
}

/// 异步获取指定网卡当前配置的 DNS 信息
pub async fn get_interface_dns_info(alias: &str) -> Result<(bool, Vec<String>), String> {
    #[cfg(windows)]
    {
        let alias = alias.to_owned();
        tokio::task::spawn_blocking(move || native::read(Some(&alias)).map(|value| (value.automatic, value.servers)))
            .await.map_err(|_| "读取网卡 DNS 任务失败")?
    }
    #[cfg(not(windows))]
    {
        let _ = alias;
        Ok((true, Vec::new()))
    }
}

/// 检查本地 DNS 53 服务就绪状态 (C03: 防范核心未启动或未监听 53 端口导致断网)
pub async fn check_dns_service_ready() -> Result<(), String> {
    let is_running = crate::commands::process::ACTIVE.load(std::sync::atomic::Ordering::SeqCst);
    if !is_running {
        return Err("Mihomo 核心当前未运行，无法启用 DNS 护航。请先启动核心。".into());
    }

    let raw = std::fs::read_to_string(crate::storage::data_dir().join("core_data/config.yaml"))
        .map_err(|_| "读取核心 DNS 运行配置失败，未启用护航")?;
    let pid = super::process::PID.load(std::sync::atomic::Ordering::SeqCst);
    super::dns_runtime::confirm_guard(&raw, pid).await
}

/// 启用本地 DNS 护航（WinDivert 模式采用驱动层 53 -> 动态高位端口透明转发；常规模式将网卡首选 DNS 指向 127.0.0.1）
pub async fn enable_dns_guard(origin: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _guard = ADAPTER_LOCK.lock().await;

        let is_running = crate::commands::process::ACTIVE.load(std::sync::atomic::Ordering::SeqCst);
        if !is_running {
            return Err("Mihomo 核心当前未运行，无法启用 DNS 护航。请先启动核心。".into());
        }

        let use_windivert = super::settings::get_general_settings()
            .is_ok_and(|s| s.traffic_mode == crate::capture::windivert::plan::MODE);

        let path = recovery_path();
        let target_origin = origin.unwrap_or_else(|| "manual".into());

        if use_windivert {
            let mut final_origin = target_origin;
            if path.exists() {
                if let Ok(bytes) = std::fs::read(&path) {
                    if let Ok(existing) = serde_json::from_slice::<DnsAdapterRecovery>(&bytes) {
                        if existing.origin.as_deref() == Some("manual") && final_origin == "bundle" {
                            final_origin = "manual".into();
                        }
                    }
                }
            }

            let record = DnsAdapterRecovery {
                interface_alias: String::new(),
                was_dhcp: true,
                static_dns: Vec::new(),
                windivert_mode: true,
                origin: Some(final_origin),
            };
            let json = serde_json::to_vec_pretty(&record).map_err(|e| e.to_string())?;
            let save_path = path.clone();
            tokio::task::spawn_blocking(move || crate::storage::replace(&save_path, &json))
                .await
                .map_err(|_| "保存 DNS 护航状态失败")??;

            if let Err(e) = crate::routing_overrides::reapply(&crate::routing_overrides::read()?).await {
                let _ = tokio::fs::remove_file(&path).await;
                return Err(format!("启用 WinDivert 透明 DNS 护航失败: {e}"));
            }
            let _ = run_hidden_cmd_async("ipconfig", &["/flushdns"], 4).await;
            return Ok(());
        }

        // C03: 严格校验本地 DNS 服务就绪后再修改系统网卡
        check_dns_service_ready().await?;

        let adapter = tokio::task::spawn_blocking(|| native::read(None)).await.map_err(|_| "读取网卡任务失败")??;
        let (alias, was_dhcp, static_dns) = (adapter.alias, adapter.automatic, adapter.servers);

        // 如果已经是指向 127.0.0.1，说明已处于护航状态
        if static_dns.first().map(|s| s.as_str()) == Some("127.0.0.1") {
            if path.exists() {
                if let Ok(bytes) = std::fs::read(&path) {
                    if let Ok(mut existing) = serde_json::from_slice::<DnsAdapterRecovery>(&bytes) {
                        if target_origin == "manual" && existing.origin.as_deref() != Some("manual") {
                            existing.origin = Some("manual".into());
                            let json = serde_json::to_vec_pretty(&existing).map_err(|e| e.to_string())?;
                            let save_path = path.clone();
                            let _ = tokio::task::spawn_blocking(move || crate::storage::replace(&save_path, &json)).await;
                        }
                    }
                }
            }
            return Ok(());
        }

        let record = DnsAdapterRecovery {
            interface_alias: alias.clone(),
            was_dhcp,
            static_dns: static_dns.clone(),
            windivert_mode: false,
            origin: Some(target_origin),
        };

        // 保存恢复快照凭证
        let json = serde_json::to_vec_pretty(&record).map_err(|e| e.to_string())?;
        let save_path = path.clone();
        tokio::task::spawn_blocking(move || crate::storage::replace(&save_path, &json)).await.map_err(|_| "保存 DNS 恢复记录失败")??;

        // 将网卡首选 DNS 设为 127.0.0.1 (带超时防护)
        let set_res = run_hidden_cmd_async(
            "netsh",
            &["interface", "ipv4", "set", "dnsservers", &format!("name={}", alias), "static", "127.0.0.1", "primary"],
            5
        ).await;

        if let Err(e) = set_res {
            // A timeout can occur after Windows accepted the write. Preserve recovery.
            return Err(format!("修改网卡 DNS 失败: {}；已保留恢复记录", e));
        }

        // 刷新系统 DNS 解析缓存
        let _ = run_hidden_cmd_async("ipconfig", &["/flushdns"], 4).await;

        // 回读核验修改结果
        let (automatic, current_dns) = get_interface_dns_info(&alias).await?;
        if automatic || current_dns.first().map(|s| s.as_str()) != Some("127.0.0.1") {
            return Err("网卡 DNS 回读未确认护航生效，已保留恢复记录，请重试或恢复 DNS".into());
        }

        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = origin;
        Err("当前平台支持核心内 DNS 分流，暂不支持修改系统网卡 DNS".into())
    }
}

/// 恢复网卡原始 DNS 配置 (C04: 验证恢复成功后再删除快照文件)
pub async fn restore_dns_guard() -> Result<(), String> {
    #[cfg(windows)]
    {
        let _guard = ADAPTER_LOCK.lock().await;
        let path = recovery_path();
        if !path.exists() {
            return Ok(());
        }

        let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
        let record: DnsAdapterRecovery = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;

        if record.windivert_mode {
            tokio::fs::remove_file(&path).await.map_err(|_| "清理 DNS 护航状态失败，请重试")?;
            if crate::commands::process::ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {
                if let Ok(config) = crate::routing_overrides::read() {
                    let _ = crate::routing_overrides::reapply(&config).await;
                }
            }
            let _ = run_hidden_cmd_async("ipconfig", &["/flushdns"], 4).await;
            return Ok(());
        }

        let alias = &record.interface_alias;
        let restore_res = if record.was_dhcp || record.static_dns.is_empty() {
            run_hidden_cmd_async(
                "netsh",
                &["interface", "ipv4", "set", "dnsservers", &format!("name={}", alias), "source=dhcp"],
                5
            ).await
        } else {
            let primary = &record.static_dns[0];
            let prim_res = run_hidden_cmd_async(
                "netsh",
                &["interface", "ipv4", "set", "dnsservers", &format!("name={}", alias), "static", primary, "primary"],
                5
            ).await;
            if prim_res.is_ok() {
                for (idx, secondary) in record.static_dns.iter().skip(1).enumerate() {
                    let index_arg = format!("index={}", idx + 2);
                    run_hidden_cmd_async(
                        "netsh",
                        &["interface", "ipv4", "add", "dnsservers", &format!("name={}", alias), secondary, &index_arg],
                        4
                    ).await.map_err(|e| format!("恢复备用 DNS 失败：{e}；已保留恢复记录"))?;
                }
            }
            prim_res
        };

        if let Err(e) = restore_res {
            return Err(format!("恢复网卡 DNS 失败: {}；已保留恢复记录以备重试", e));
        }

        let _ = run_hidden_cmd_async("ipconfig", &["/flushdns"], 4).await;

        let (automatic, current_servers) = get_interface_dns_info(alias).await?;
        verify_restored(&record, automatic, &current_servers)?;
        tokio::fs::remove_file(&path).await.map_err(|_| "DNS 已恢复，但恢复记录清理失败，请重试")?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

fn verify_restored(record: &DnsAdapterRecovery, automatic: bool, servers: &[String]) -> Result<(), String> {
    let expected_automatic = record.was_dhcp || record.static_dns.is_empty();
    if automatic != expected_automatic || (!expected_automatic && servers != record.static_dns)
        || servers.first().is_some_and(|ip| ip == "127.0.0.1") {
        return Err("DNS 回读与恢复目标不一致，已保留恢复记录，请重试".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn performance_restoration_requires_mode_and_all_static_servers() {
        let mut record = DnsAdapterRecovery { interface_alias: "test".into(), was_dhcp: false, static_dns: vec!["1.1.1.1".into(), "8.8.8.8".into()], windivert_mode: false, origin: None };
        assert!(verify_restored(&record, false, &record.static_dns).is_ok());
        assert!(verify_restored(&record, false, &record.static_dns[..1]).is_err());
        assert!(verify_restored(&record, true, &record.static_dns).is_err());
        record.was_dhcp = true;
        assert!(verify_restored(&record, true, &["192.0.2.1".into()]).is_ok());
        assert!(verify_restored(&record, true, &["127.0.0.1".into()]).is_err());
    }
}

/// 冷启动断网自愈检查 (C05: 异步执行，不阻塞 UI 启动)
pub async fn auto_recover_dns_on_startup() {
    #[cfg(windows)]
    {
        let path = recovery_path();
        if path.exists() {
            eprintln!("[DnsAdapter] 检测到上次未恢复的 DNS 护航快照，正在后台执行网络自愈恢复...");
            if let Err(e) = restore_dns_guard().await {
                eprintln!("[DnsAdapter] 启动自动恢复 DNS 失败: {}", e);
            } else {
                eprintln!("[DnsAdapter] 启动自动恢复 DNS 成功！");
            }
        }
    }
}

/// 一键网络急救：强制重置主要网卡 DNS 为 DHCP，并清理系统代理
pub async fn emergency_repair_network() -> Result<String, String> {
    #[cfg(windows)]
    {
        let _lifecycle = super::process::LIFECYCLE.lock().await;
        let _guard = ADAPTER_LOCK.lock().await;

        // 1. 强制重置系统代理
        super::sysproxy::reset_system_proxy_emergency()?;

        // 2. 尝试将主要网卡复位为 DHCP
        if let Ok(alias) = get_active_interface_alias().await {
            let _ = run_hidden_cmd_async(
                "netsh",
                &["interface", "ipv4", "set", "dnsservers", &format!("name={}", alias), "source=dhcp"],
                5
            ).await;
        }

        // 3. 清理 recovery 凭据
        let path = recovery_path();
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }

        // 4. 刷新 DNS 缓存
        let _ = run_hidden_cmd_async("ipconfig", &["/flushdns"], 4).await;

        Ok("网络急救完成：已尝试将网卡 DNS 恢复为自动获取 (DHCP)，并释放本程序接管的系统代理；其他代理配置保持不变。".into())
    }
    #[cfg(not(windows))]
    {
        super::sysproxy::reset_system_proxy_emergency()?;
        Ok("已释放本程序持有的系统代理；应用代理模式未修改系统 DNS".into())
    }
}

#[tauri::command]
pub async fn toggle_dns_guard(enable: bool, origin: Option<String>) -> Result<bool, String> {
    let _lifecycle = super::process::LIFECYCLE.lock().await;
    if enable { crate::function_mode::require_full()?; }
    if crate::shutdown::in_progress() { return Err("正在恢复网络并退出，请稍候".into()); }
    if enable {
        enable_dns_guard(origin).await?;
        Ok(true)
    } else {
        // 如果是由业务包生命周期发起的关闭请求 (origin == "bundle")：
        // 必须核验当前护航的归属：若用户已手动接管 ("manual")，则绝对不关闭，恪守用户最高主权！
        if origin.as_deref() == Some("bundle") {
            let path = recovery_path();
            if path.exists() {
                if let Ok(bytes) = std::fs::read(&path) {
                    if let Ok(record) = serde_json::from_slice::<DnsAdapterRecovery>(&bytes) {
                        if record.origin.as_deref() == Some("manual") {
                            return Ok(true);
                        }
                    }
                }
            }
        }
        restore_dns_guard().await?;
        Ok(false)
    }
}

#[tauri::command]
pub fn get_dns_guard_status() -> Result<bool, String> {
    let path = recovery_path();
    Ok(path.exists())
}

#[tauri::command]
pub fn get_dns_guard_info() -> Result<DnsGuardInfo, String> {
    let path = recovery_path();
    if !path.exists() {
        return Ok(DnsGuardInfo {
            enabled: false,
            origin: "none".into(),
            windivert_mode: false,
        });
    }
    let Ok(bytes) = std::fs::read(&path) else {
        return Ok(DnsGuardInfo {
            enabled: false,
            origin: "none".into(),
            windivert_mode: false,
        });
    };
    let record: DnsAdapterRecovery = serde_json::from_slice(&bytes).unwrap_or(DnsAdapterRecovery {
        interface_alias: String::new(),
        was_dhcp: true,
        static_dns: Vec::new(),
        windivert_mode: false,
        origin: None,
    });
    Ok(DnsGuardInfo {
        enabled: true,
        origin: record.origin.unwrap_or_else(|| "manual".into()),
        windivert_mode: record.windivert_mode,
    })
}

#[tauri::command]
pub async fn run_network_emergency_repair() -> Result<String, String> {
    emergency_repair_network().await
}
