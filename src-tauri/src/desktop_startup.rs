use crate::{app_lifecycle, capture, commands, external_proxy, function_mode, local_nodes, routing_overrides, storage};
use serde::{Deserialize, Serialize};
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const NOTICE_VERSION: u32 = 2;
const CONFIRMATION_PHRASE: &str = "我已阅读并理解以上说明";
static STARTED: AtomicBool = AtomicBool::new(false);
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum GuideMethod {
    System,
    Process,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuideProgress {
    dismissed: bool,
    method: Option<GuideMethod>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Confirmation {
    notice_version: u32,
    confirmed_at: u64,
    #[serde(default)]
    guide: GuideProgress,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FirstUseStatus {
    confirmed: bool,
    notice_version: u32,
    confirmation_phrase: &'static str,
    guide: GuideProgress,
}

impl Confirmation {
    fn current(&self) -> bool {
        self.notice_version == NOTICE_VERSION && self.confirmed_at > 0
    }
}

fn confirmation_path() -> std::path::PathBuf {
    storage::data_dir().join("config/first-use.json")
}

fn read_confirmation() -> Option<Confirmation> {
    let bytes = std::fs::read(confirmation_path()).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn store_confirmation(confirmation: &Confirmation) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(confirmation).map_err(|error| error.to_string())?;
    storage::replace_atomic(&confirmation_path(), &bytes)
        .map_err(|error| format!("保存首次使用确认失败：{error}"))
}

fn has_saved_configuration() -> bool {
    !commands::profile::read_profiles_index().is_empty()
        || local_nodes::read().is_ok_and(|store| !store.nodes.is_empty())
        || routing_overrides::read().is_ok_and(|config| {
            !config.process_rules.is_empty() || config.bundles.iter().any(|bundle| bundle.main_target.is_some())
        })
}

pub(crate) fn started() -> bool {
    STARTED.load(Ordering::Acquire)
}

#[tauri::command]
pub(crate) fn get_first_use_status() -> FirstUseStatus {
    FirstUseStatus {
        confirmed: started(),
        notice_version: NOTICE_VERSION,
        confirmation_phrase: CONFIRMATION_PHRASE,
        guide: read_confirmation().map_or_else(GuideProgress::default, |record| record.guide),
    }
}

#[tauri::command]
pub(crate) fn confirm_first_use(
    app: AppHandle,
    version: u32,
    phrase: String,
) -> Result<FirstUseStatus, String> {
    if version != NOTICE_VERSION || phrase.trim() != CONFIRMATION_PHRASE {
        return Err("请输入弹窗中完整的确认语".into());
    }
    let _lock = STORE_LOCK.lock().map_err(|_| "读取首次使用设置失败")?;
    let previous = read_confirmation();
    if !previous.as_ref().is_some_and(Confirmation::current) {
        let confirmed_at = SystemTime::now()
            .duration_since(UNIX_EPOCH).map_err(|_| "无法读取系统时间")?
            .as_millis() as u64;
        let guide = previous.map_or_else(
            || GuideProgress { dismissed: has_saved_configuration(), method: None },
            |record| record.guide,
        );
        store_confirmation(&Confirmation { notice_version: NOTICE_VERSION, confirmed_at, guide })?;
    }
    start_runtime(&app)?;
    Ok(get_first_use_status())
}

#[tauri::command]
pub(crate) fn exit_first_use(app: AppHandle) -> Result<(), String> {
    let _lock = STORE_LOCK.lock().map_err(|_| "读取首次使用设置失败")?;
    if started() {
        return Err("请通过主窗口退出软件".into());
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub(crate) fn save_guide_progress(guide: GuideProgress) -> Result<(), String> {
    let _lock = STORE_LOCK.lock().map_err(|_| "读取首次使用设置失败")?;
    let mut confirmation = read_confirmation().filter(Confirmation::current)
        .ok_or("请先确认首次使用须知")?;
    confirmation.guide = guide;
    store_confirmation(&confirmation)
}

pub(crate) fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_icon(tauri::include_image!("icons/128x128.png"))?;
    }
    if read_confirmation().is_some_and(|record| record.current()) {
        start_runtime(app).map_err(std::io::Error::other)?;
    } else {
        app_lifecycle::show(app);
    }
    Ok(())
}

fn start_runtime(app: &AppHandle) -> Result<(), String> {
    if started() {
        return Ok(());
    }
    let proxy_recovery_ready = match commands::sysproxy::recover_stale_proxy() {
        Ok(()) => true,
        Err(error) => {
            #[cfg(target_os = "macos")]
            { eprintln!("macOS 系统代理恢复待处理：{error}"); false }
            #[cfg(not(target_os = "macos"))]
            { return Err(error); }
        }
    };
    app_lifecycle::setup(app).map_err(|error| error.to_string())?;
    STARTED.store(true, Ordering::Release);

    let args: Vec<_> = std::env::args().collect();
    let direct_launch = args.iter().any(|arg| matches!(arg.as_str(), "--direct" | "--shim" | "--quick"));
    commands::bundle_launch::dispatch(app, args);
    let dns_app = app.clone();
    tauri::async_runtime::spawn(async move {
        commands::dns_adapter::auto_recover_dns_on_startup().await;
        let _ = dns_app.emit("procweaver-dns-guard-changed", ());
    });
    commands::process_watcher::init_watcher_on_startup();
    tauri::async_runtime::spawn(external_proxy::restore());
    tauri::async_runtime::spawn(commands::geo::run_scheduler());
    tauri::async_runtime::spawn(commands::profile::run_profile_scheduler(app.clone()));
    tauri::async_runtime::spawn(routing_overrides::policy_groups::admission::run(app.clone()));
    let monitor_app = app.clone();
    tauri::async_runtime::spawn(routing_overrides::tracker::run(move |change| {
        let _ = monitor_app.emit("procweaver-processes-changed", change);
    }));
    tauri::async_runtime::spawn(capture::run());

    let silent_start = commands::settings::get_general_settings().is_ok_and(|settings| settings.silent_start);
    if (!proxy_recovery_ready || !silent_start) && !direct_launch {
        app_lifecycle::show(app);
    }
    if function_mode::core_features_enabled() && proxy_recovery_ready {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = commands::process::start_core(None, handle.state()).await {
                eprintln!("自动运行核心失败：{error}");
                app_lifecycle::show(&handle);
            }
        });
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if function_mode::core_features_enabled() {
                if let Err(error) = commands::process::monitor_core(handle.state()).await {
                    eprintln!("内核监控失败：{error}");
                }
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_timestamped_confirmation_for_the_current_notice_is_valid() {
        let parse = |notice_version, confirmed_at| {
            serde_json::from_value::<Confirmation>(serde_json::json!({
                "noticeVersion": notice_version,
                "confirmedAt": confirmed_at
            })).unwrap()
        };
        assert!(parse(NOTICE_VERSION, 1).current());
        assert!(!parse(NOTICE_VERSION, 0).current());
        assert!(!parse(NOTICE_VERSION + 1, 1).current());
        assert!(!parse(NOTICE_VERSION, 1).guide.dismissed);
    }
}
