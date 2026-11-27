pub mod model;
pub mod composer;
pub mod tracker;
pub mod ownership;
pub mod native;
pub mod bundles;
pub mod public_mode;
pub mod foreign_targets;
pub(crate) mod filters;
#[cfg(windows)]
pub(crate) mod hot_reset;
mod target_cache;
#[cfg(test)] mod tests;
#[cfg(test)] mod bundle_runtime_tests;
#[cfg(all(test, windows))] mod instance_runtime_tests;
use model::*;
use crate::commands::{profile, settings, local_rules, exclusions, process};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, atomic::Ordering};

static APPLIED: Mutex<Option<(u64, u64)>> = Mutex::new(None);
static SYSTEM_PROXY_ROUTED: Mutex<Option<bool>> = Mutex::new(None);
pub(crate) fn reset_system_proxy_observation() {
    *SYSTEM_PROXY_ROUTED.lock().unwrap_or_else(|p| p.into_inner()) = None;
}
pub fn set_applied(revision: u64, generation: u64) { *APPLIED.lock().unwrap_or_else(|p| p.into_inner()) = Some((revision, generation)); }
pub(crate) fn path() -> std::path::PathBuf { crate::storage::data_dir().join("config/routing-overrides.json") }
pub(crate) use target_cache::invalidate as invalidate_profile_targets;
fn read_saved() -> Result<Overrides, String> {
    match std::fs::read(path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "进程 / DNS 规则损坏，请恢复备份，未覆盖原文件".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Overrides::default()),
        Err(_) => Err("无法读取进程 / DNS 规则".into()),
    }
}

pub(crate) fn unbound_existing_rule_bundles() -> Vec<String> {
    read_saved().map(|config| config.bundles.into_iter()
        .filter(BundleRoute::is_unbound_existing_rules_bundle)
        .map(|bundle| bundle.id).collect()).unwrap_or_default()
}

pub fn read() -> Result<Overrides, String> {
    let config = read_saved()?;
    #[cfg(target_os = "android")]
    let config = config.without_bundles();
    let mut config = config;
    config.pause_unbound_existing_rule_bundles();
    let mut config = normalize(config)?;
    if cfg!(windows) {
        config.assign_process_ports(&config.clone())?;
    }
    Ok(config)
}
pub fn current_source() -> (String, std::path::PathBuf) {
    profile::read_profiles_index().into_iter().find(|p| p.is_selected)
        .map(|p| (p.id, profile::get_base_dir().join(p.file_path)))
        .unwrap_or_else(|| ("default".into(), profile::get_base_dir().join("config/default.yaml")))
}
pub fn prepare(raw: &str, config: &Overrides, profile_id: &str) -> Result<String, String> {
    prepare_with_nodes(raw, config, profile_id, &crate::local_nodes::read()?)
}
pub fn prepare_with_nodes(raw: &str, config: &Overrides, profile_id: &str, nodes: &crate::local_nodes::Store) -> Result<String, String> {
    validate_business_capture(config)?;
    let follows_system = !cfg!(target_os = "android") && config.bundles_enabled && config.bundles.iter().any(BundleRoute::follows_system_proxy);
    let enabled = if follows_system { crate::commands::sysproxy::get_system_proxy_status()? } else { false };
    prepare_plan(raw, config, profile_id, enabled, nodes, None)
}

/// The lifecycle observer calls this under LIFECYCLE. Unknown reads never change routing.
pub(crate) async fn reconcile_system_proxy(status: &crate::commands::sysproxy::SystemProxyStatus) -> Result<(), String> {
    if status.state == "unknown" { return Ok(()); }
    if !process::ACTIVE.load(Ordering::SeqCst) {
        *SYSTEM_PROXY_ROUTED.lock().map_err(|_| "系统代理分流状态锁不可用")? = None;
        return Ok(());
    }
    let enabled = status.enabled();
    if *SYSTEM_PROXY_ROUTED.lock().map_err(|_| "系统代理分流状态锁不可用")? == Some(enabled) { return Ok(()); }
    let config = read()?;
    if config.bundles_enabled && config.bundles.iter().any(BundleRoute::follows_system_proxy) {
        let (id, source) = current_source();
        let raw = std::fs::read_to_string(source).map_err(|_| "读取系统代理联动配置失败")?;
        let prepared = prepare_with_system_proxy(&raw, &config, &id, enabled)?;
        profile::validate_config(&prepared)?;
        apply_runtime(&prepared).await?;
    }
    *SYSTEM_PROXY_ROUTED.lock().map_err(|_| "系统代理分流状态锁不可用")? = Some(enabled);
    Ok(())
}
fn prepare_with_system_proxy(raw: &str, config: &Overrides, profile_id: &str, system_proxy: bool) -> Result<String, String> {
    validate_business_capture(config)?;
    prepare_plan(raw, config, profile_id, system_proxy, &crate::local_nodes::read()?, None)
}
pub(crate) fn prepare_public_mode(raw: &str, config: &Overrides, profile_id: &str, mode: &str) -> Result<String, String> {
    validate_business_capture(config)?;
    let system = crate::commands::sysproxy::get_system_proxy_status()?;
    prepare_plan(raw, config, profile_id, system, &crate::local_nodes::read()?, Some(mode))
}
fn validate_business_capture(config: &Overrides) -> Result<(), String> {
    let general = settings::get_general_settings()?;
    crate::capture::validate_business_remote_dns(&config.effective(), &general.traffic_mode, general.tun_mode)
}
fn prepare_plan(raw: &str, config: &Overrides, profile_id: &str, system_proxy: bool, nodes: &crate::local_nodes::Store, mode: Option<&str>) -> Result<String, String> {
    let effective = config.effective();
    let config = &effective;
    let mut general = settings::get_general_settings()?;
    if let Some(mode) = mode { general.run_mode = public_mode::normalize(mode)?.into(); }
    if public_mode::enabled() && serde_yaml::from_str::<serde_yaml::Value>(raw).ok().is_some_and(|v| v.get(public_mode::KEY).is_some()) {
        return Err("订阅包含公共模式保留字段".into());
    }
    let base = settings::prepare_with(raw, &general)?;
    let base = crate::local_nodes::compose(&base, nodes)?;
    let base = local_rules::compose(&base, &local_rules::get_local_rule_plan()?)?;
    let locals = crate::local_nodes::map_config(config, profile_id);
    let (base, foreign_mapped) = foreign_targets::materialize_runtime(&base, &locals, profile_id)?;
    let (base, mut mapped) = bundles::materialize(&base, &foreign_mapped, profile_id)?;
    // 仅解析本次运行计划，持久化定义仍保留 system，重启和后续重应用会读取真实开关。
    for bundle in &mut mapped.bundles {
        if bundle.fallback == "system" { bundle.fallback = if system_proxy { "rules" } else { "direct" }.into(); }
    }
    let channels = profile::get_business_channels().unwrap_or_default();
    let mut state = tracker::status(config);
    let instance_routing = cfg!(windows) && general.traffic_mode == "windivert_v1";
    // Instance-aware capture must never publish inherited global path rules.
    if instance_routing { state.derived.clear(); }
    for rule in &mut state.derived {
        if let Some(target) = &mut rule.target { crate::local_nodes::remap(target, profile_id); foreign_targets::remap(target, config, profile_id); }
        bundles::map_process(rule, &config.bundles, profile_id);
    }
    let config = &mapped;
    // 业务包的显式进程绑定优先于公共域名/节点选择；普通手动规则仍遵循原优先级设置。
    let mut manual = config.clone();
    manual.process_rules.retain(|r| bundles::owner(&r.id, &config.bundles).is_none());
    let manual_derived: Vec<_> = state.derived.iter().filter(|r| bundles::owner(&r.id, &config.bundles).is_none()).cloned().collect();

    #[cfg(windows)]
    let dns_settings = crate::commands::dns::get_dns_settings()?;
    #[cfg(windows)]
    let bundle_dns = if !crate::edition::PROCESS && instance_routing
        && dns_settings.listener_mode != Some(crate::commands::dns::DnsListenerMode::Off)
    {
        bundles::prepare_cloudcode_dns(&base, config, profile_id)?
    } else { None };
    #[cfg(windows)]
    let base = if let Some((prepared, dns_rule)) = &bundle_dns {
        if !manual.dns_enabled { manual.dns_rules.clear(); }
        manual.dns_enabled = true;
        manual.dns_rules.push(dns_rule.clone());
        prepared.clone()
    } else { base };

    // 严密控制规则入栈顺序：后插入 0..0 者位于 rules 最终序列更顶层
    let manual_base = base.clone();
    let compose_base = |manual: &Overrides, owned: bool| -> Result<String, String> {
      let compose = |raw: &str| if owned { composer::compose_owned(raw, manual, profile_id) }
        else { composer::compose(raw, manual, profile_id, &manual_derived) };
      match general.routing_priority.as_str() {
        "process_first" => {
            // 进程强锁防关联：先注入域名，再将进程插入第 0 位
            let base = profile::compose_business_channels(&manual_base, &channels)?;
            compose(&base)
        }
        "direct_first" => {
            // 白名单直连绝对最高：先注入进程再注入域名，最后将全部 DIRECT 规则置于所有 PROXY 出站前列
            let base = compose(&manual_base)?;
            let base = profile::compose_business_channels(&base, &channels)?;
            composer::prioritize_direct_rules(&base)
        }
        _ => {
            // 默认业务专线优先（domain_first）：先注入进程规则，再将业务域名规则插入第 0 位
            let base = compose(&manual_base)?;
            profile::compose_business_channels(&base, &channels)
        }
      }
    };
    let base = compose_base(&manual, false)?;

    let exclusions = exclusions::get_exclusions()?;
    let finish = |raw:&str| -> Result<String,String> {
        let raw=exclusions::compose(raw,&exclusions)?;
        let raw=if config.process_enabled {composer::safety(&raw)?}else{raw};
        composer::ensure_bt_pt_and_proxy_group(&raw)
    };
    let base = bundles::compose_existing_rules(&finish(&base)?, config)?;
    let base = public_mode::compose(&base, &general.run_mode)?;
    #[cfg(windows)]
    let mut owner_policies = std::collections::BTreeMap::new();
    #[cfg(windows)]
    if instance_routing && config.process_enabled {
        for rule in config.process_rules.iter().filter(|r| ownership::standalone(r, config)) {
            let key = ownership::key(rule, config);
            if owner_policies.contains_key(&key) { continue; }
            let mut selected = config.clone();
            selected.process_rules = vec![rule.clone()];
            let policy = if bundles::owner(&rule.id, &config.bundles).is_some() {
                selected.dns_enabled = false;
                composer::compose_owned(&base, &selected, profile_id)?
            } else { public_mode::compose(&finish(&compose_base(&selected, true)?)?, &general.run_mode)? };
            owner_policies.insert(key, serde_yaml::from_str(&policy).map_err(|_| "实例分流策略无效")?);
        }
    }
    // Capture the existing routing plan before adding any bundle-owned process rules.
    let fallback:serde_yaml::Value=serde_yaml::from_str(&base).map_err(|_|"原有分流规则无效")?;
    let fallback=fallback["rules"].as_sequence().cloned().unwrap_or_default();
    let bundles = Overrides {
        process_enabled: config.process_enabled,
        process_rules: config.process_rules.iter().filter(|r| bundles::owner(&r.id, &config.bundles).is_some()
            && (!instance_routing || ownership::standalone(r, config))).cloned().collect(),
        bundles: config.bundles.clone(),
        ..Overrides::default()
    };
    let bundle_derived: Vec<_> = state.derived.iter().filter(|r| bundles::owner(&r.id, &config.bundles).is_some()).cloned().collect();
    // Explicit owners precede domain-wide package rules and every public bypass.
    let base = bundles::compose_bundle_rules(&base, config)?;
    let base = composer::compose(&base, &bundles, profile_id, &bundle_derived)?;
    let base = composer::safety_guard(&base)?;
    bundles::validate_remote_names(&base, config)?;
    #[cfg(windows)]
    let base = crate::commands::dns_listener::compose(&base, config, &dns_settings,
        bundle_dns.as_ref().map(|(_, rule)| rule.domain.as_str()), general.allow_lan)?;
    let base = crate::capture::compose(&base, config, profile_id, &fallback)?;
    #[cfg(windows)]
    let base = if general.traffic_mode == crate::capture::windivert::plan::MODE {
        crate::capture::windivert::plan::compose_with_policies(&base, config, &owner_policies)?
    } else { crate::capture::windivert::plan::compose_suite_dns(&base, config)? };
    #[cfg(target_os = "android")]
    if general.allow_lan {
        let mut yaml: serde_yaml::Value = serde_yaml::from_str(&base).map_err(|_| "运行配置无效")?;
        crate::commands::mobile_settings::add_lan_listener(yaml.as_mapping_mut().ok_or("运行配置必须为对象")?, &general.lan_sharing)?;
        return serde_yaml::to_string(&yaml).map_err(|_| "生成共享运行配置失败".into());
    }
    Ok(base)
}
pub async fn reapply(config: &Overrides) -> Result<(), String> {
    let (id, source) = current_source();
    if !source.exists() {
        if !process::ACTIVE.load(Ordering::SeqCst) {
            return Ok(());
        }
        return Err("请先选择有效订阅".into());
    }
    let raw = std::fs::read_to_string(source).map_err(|_| "请先选择有效订阅")?;
    let prepared = prepare(&raw, config, &id)?;
    profile::validate_config(&prepared)?;
    apply_runtime(&prepared).await
}

/// 调用方持有 LIFECYCLE。先确认核心路由，再写系统代理；系统写入失败则恢复原运行计划。
pub(crate) async fn change_system_proxy(enable: bool, change: impl FnOnce() -> Result<bool, String>) -> Result<bool, String> {
    if !process::ACTIVE.load(Ordering::SeqCst) { return change(); }
    let config = read()?;
    if !config.bundles_enabled || !config.bundles.iter().any(BundleRoute::follows_system_proxy) {
        return change();
    }
    let old = std::fs::read_to_string(crate::storage::data_dir().join("core_data/config.yaml")).map_err(|_| "读取系统代理切换前的运行配置失败")?;
    let (id, source) = current_source();
    let raw = std::fs::read_to_string(source).map_err(|_| "请先选择有效订阅")?;
    let prepared = prepare_with_system_proxy(&raw, &config, &id, enable)?;
    profile::validate_config(&prepared)?;
    apply_runtime(&prepared).await?;
    match change() {
        Ok(actual) if actual == enable => {
            *SYSTEM_PROXY_ROUTED.lock().map_err(|_| "系统代理分流状态锁不可用")? = Some(actual);
            Ok(actual)
        },
        result => {
            let error = result.err().unwrap_or_else(|| "系统代理状态未确认".into());
            apply_runtime(&old).await.map_err(|restore| format!("系统代理切换失败：{error}；原路由恢复失败：{restore}"))?;
            Err(format!("系统代理切换失败，已恢复原路由：{error}"))
        }
    }
}

/// 所有调用方已持有 LIFECYCLE。超时也可能已应用，因此错误时必须重新加载旧配置。
pub async fn apply_runtime(prepared: &str) -> Result<(), String> {
    if !process::ACTIVE.load(Ordering::SeqCst) {
        let target = crate::storage::data_dir().join("core_data/config.yaml");
        return crate::storage::replace_atomic(&target, prepared.as_bytes());
    }
    #[cfg(windows)]
    let resolved = crate::commands::dns_listener::resolve_for_apply(prepared, process::PID.load(Ordering::SeqCst)).await?;
    #[cfg(windows)]
    let resolved = crate::capture::windivert::ports::resolve_for_apply(&resolved, process::PID.load(Ordering::SeqCst)).await?;
    #[cfg(windows)]
    let prepared = resolved.as_str();
    let target = crate::storage::data_dir().join("core_data/config.yaml");
    let old = std::fs::read_to_string(&target).map_err(|_| "读取旧运行配置失败")?;
    // Android also reconciles package-owned connections and selections in its host.
    let reload_needed = cfg!(target_os = "android") || bundles::structural(&old)? != bundles::structural(prepared)?;
    let pid = process::PID.load(Ordering::SeqCst);
    crate::commands::dns_runtime::preflight(prepared, pid).await?;
    let applied = async {
        if reload_needed { crate::capture::pause(); }
        crate::storage::replace_atomic(&target, prepared.as_bytes())?;
        if reload_needed { reload(&target).await?; }
        bundles::select(prepared).await?;
        crate::commands::dns_runtime::confirm(prepared, pid).await?;
        crate::capture::confirm_runtime(prepared).await
    }.await;
    if let Err(error) = applied {
        crate::storage::replace_atomic(&target, old.as_bytes()).map_err(|_| format!("{error}；恢复旧运行文件失败，请使用备份恢复"))?;
        let restored = async {
            if reload_needed { reload(&target).await?; }
            bundles::select(&old).await?;
            crate::commands::dns_runtime::confirm(&old, pid).await?;
            crate::capture::confirm_runtime(&old).await
        }.await;
        if let Err(restore) = restored { crate::capture::failed(&restore); return Err(format!("{error}；旧文件已恢复，但核心恢复未确认：{restore}")); }
        return Err(format!("{error}；已恢复旧运行配置"));
    }
    #[cfg(windows)]
    crate::commands::dns_listener::remember_success(prepared);
    Ok(())
}
async fn reload(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let config = std::fs::read_to_string(path).map_err(|_| "运行配置读取失败")?;
        let _: serde_json::Value = crate::platform::android::call_async("reload", serde_json::json!({"config": config})).await?;
        crate::commands::mihomo_api::invalidate_monitor_types();
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
    let canonical = std::fs::canonicalize(path).map_err(|_| "运行路径无效")?;
    let text = canonical.to_string_lossy(); let path = text.strip_prefix(r"\\?\").unwrap_or(&text);
    let port = settings::get_general_settings()?.controller_port;
    let client = crate::commands::mihomo_api::controller_client().timeout(std::time::Duration::from_secs(10)).build().map_err(|_| "创建核心连接失败")?;
    let response = client.put(format!("http://127.0.0.1:{port}/configs?force=true")).json(&serde_json::json!({"path":path})).send().await.map_err(|_| "核心应用超时或连接失败")?;
    if !response.status().is_success() { return Err(format!("核心拒绝配置：HTTP {}", response.status())); }
    crate::commands::mihomo_api::invalidate_monitor_types();
    let result = client.get(format!("http://127.0.0.1:{port}/configs")).send().await.map_err(|_| "核心应用后核对失败")?;
    if !result.status().is_success() { return Err("核心应用后核对失败".into()); }
    Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub target_labels: std::collections::BTreeMap<String, String>,
    pub traffic_driver: String,
    pub capture: crate::capture::Status,
    pub config: Overrides, pub targets: Vec<Target>, pub tracking: tracker::TrackingStatus,
    pub running: bool, pub applied_revision: Option<u64>, pub applied_generation: Option<u64>,
    pub unavailable_rules: Vec<String>,
    pub preserved_targets: Vec<Target>,
    #[cfg(windows)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hot_reset: Option<hot_reset::Notice>,
}
pub fn view() -> Result<View, String> {
    let config = read()?; let (id, source) = current_source();
    let mut targets = target_cache::targets(&id, &source)?;
    let nodes = crate::local_nodes::read()?;
    targets.extend(nodes.nodes.iter().map(|n| n.target()));
    let target_labels = nodes.nodes.iter().map(|n| (n.alias(), format!("{} · 本地", n.name))).collect();
    let preserved_targets = foreign_targets::saved_bindings(&config, &id);
    let mut available = targets.clone();
    if config.retain_foreign_targets { available.extend(foreign_targets::available(&preserved_targets)); }
    let effective = config.effective();
    let mut unavailable_rules: Vec<_> = effective.process_rules.iter()
        .filter(|r| r.enabled && r.action == "proxy" && r.target.as_ref().is_none_or(|t| !available.contains(t)))
        .map(|r| r.id.clone()).collect();
    unavailable_rules.extend(effective.dns_rules.iter().filter(|r| r.enabled && !available.contains(&r.target)).map(|r| r.id.clone()));
    unavailable_rules.extend(effective.bundles.iter().filter(|b| b.enabled && [&b.main_target, &b.dns_target].into_iter().flatten().any(|t| !available.contains(t))).map(|b| format!("bundle:{}",b.id)));
    let mut tracking = tracker::status(&config);
    #[cfg(windows)]
    if settings::get_general_settings()?.traffic_mode == "windivert_v1" {
        tracking.derived.clear();
        tracking.conflicts.clear();
    }
    let running = process::ACTIVE.load(Ordering::SeqCst);
    let applied = if running { *APPLIED.lock().unwrap_or_else(|p| p.into_inner()) } else { None };
    Ok(View {
        target_labels, traffic_driver: crate::capture::smart_arbiter::get_active_driver_name(), capture: crate::capture::status(),
        config, targets, preserved_targets, tracking, running,
        applied_revision: applied.map(|p| p.0), applied_generation: applied.map(|p| p.1), unavailable_rules,
        #[cfg(windows)]
        hot_reset: None,
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection { pub identity: String, pub executable_path: String }
pub async fn save(config: Overrides, selections: Vec<Selection>) -> Result<View, String> {
    #[cfg(target_os = "android")]
    let config = config.without_bundles();
    let _lock = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    let old = read()?;
    let _notice = save_locked(config, selections, old).await?;
    let view = view()?;
    #[cfg(windows)]
    let view = View { hot_reset: _notice.hot_reset, ..view };
    Ok(view)
}

/// Remove the saved route and its owned rules while the caller holds LIFECYCLE.
pub(crate) async fn remove_bundle_locked(instance_id: &str) -> Result<(), String> {
    let old = read()?;
    if !old.bundles.iter().any(|bundle| bundle.id == instance_id) {
        return Ok(());
    }
    crate::function_mode::require_full()?;
    let mut next = old.clone();
    next.bundles.retain(|bundle| bundle.id != instance_id);
    next.process_rules.retain(|rule| {
        !bundles::owner(&rule.id, &old.bundles).is_some_and(|bundle| bundle.id == instance_id)
    });
    next.dns_rules.retain(|rule| {
        !bundles::dns_owner(&rule.id, &old.bundles).is_some_and(|bundle| bundle.id == instance_id)
    });
    save_locked(next, Vec::new(), old).await.map(drop)
}

#[derive(Default)]
struct SaveNotice {
    #[cfg(windows)]
    hot_reset: Option<hot_reset::Notice>,
}

async fn save_locked(config: Overrides, selections: Vec<Selection>, old: Overrides) -> Result<SaveNotice, String> {
    if config.revision != old.revision { return Err("规则已被其他页面修改，请重新加载后再保存".into()); }
    let mut config = normalize(config)?;
    #[cfg(windows)]
    for bundle in config.bundles.iter().filter(|bundle| bundle.enabled
        || !old.bundles.iter().any(|previous| previous.id == bundle.id && previous.policy == bundle.policy))
    {
        filters::validate_bundle(bundle)?;
    }
    crate::external_proxy::check_core_conflicts(&config)?;
    let active = current_source().0;
    let preserved = foreign_targets::saved_bindings(&old, &active);
    if foreign_targets::saved_bindings(&config, &active).iter().any(|target| !preserved.contains(target)) {
        return Err("新出口不属于当前订阅，也不是已有保留绑定，请选择当前订阅出口重新绑定".into());
    }
    bundles::assign_ports(&mut config, &old)?;
    if cfg!(windows) {
        config.assign_process_ports(&old)?;
    }
    if selections.len() > 256 { return Err("一次最多选择 256 个进程".into()); }
    if !selections.is_empty() || (config.effective().process_enabled && config.effective().process_rules.iter().any(|r| r.enabled && r.include_descendants)) {
        let processes = native::snapshot()?;
        for s in selections { if !processes.iter().any(|p| p.identity == s.identity && p.executable_path.as_deref() == Some(s.executable_path.as_str())) {
            return Err("所选进程已退出或身份改变，请刷新进程树后重新选择".into());
        } }
        tracker::reconcile(processes, false);
    }
    if !(cfg!(windows) && settings::get_general_settings()?.traffic_mode == "windivert_v1") {
        if let Some(error) = tracker::conflict_message(&tracker::status(&config).conflicts) { return Err(error); }
    }
    config.revision = old.revision.checked_add(1).ok_or("规则修订号已耗尽")?;
    let old_runtime = if process::ACTIVE.load(Ordering::SeqCst) { Some(std::fs::read_to_string(crate::storage::data_dir().join("core_data/config.yaml")).map_err(|_| "读取恢复配置失败")?) } else { None };
    #[cfg(windows)]
    let hot_reset = hot_reset::snapshot(&old, &config, old_runtime.as_deref()).await;
    // Removing/disabling bundle rules while offline must not require a Mihomo
    // executable. New effective rules still take the existing validation path.
    let removal_only = !process::ACTIVE.load(Ordering::SeqCst)
        && config.process_enabled == old.process_enabled && config.dns_enabled == old.dns_enabled
        && config.retain_foreign_targets == old.retain_foreign_targets
        && config.process_rules.iter().all(|r| old.process_rules.contains(r))
        && config.dns_rules.iter().all(|r| old.dns_rules.iter().any(|o| serde_json::to_value(o).ok() == serde_json::to_value(r).ok()))
        && config.bundles.iter().all(|b| !b.enabled || old.bundles.iter().any(|o| serde_json::to_value(o).ok() == serde_json::to_value(b).ok()));
    if !removal_only { reapply(&config).await?; }
    let bytes = serde_json::to_vec_pretty(&config).map_err(|_| "规则序列化失败")?;
    if let Err(e) = crate::storage::replace_atomic(&path(), &bytes) {
        if let Some(raw) = old_runtime { apply_runtime(&raw).await.map_err(|restore| format!("保存失败：{e}；恢复失败：{restore}"))?; }
        return Err(format!("保存失败，已恢复原运行配置：{e}"));
    }
    set_applied(config.revision, tracker::status(&config).generation);
    #[cfg(windows)] {
        let eff = config.effective();
        let mut ports: Vec<_> = eff.bundles.iter().filter(|b| b.enabled).map(|b| b.port).collect();
        if eff.process_enabled {
            for r in &eff.process_rules {
                if r.enabled && r.action == "proxy"
                    && !r.target.as_ref().is_some_and(|target| target.name.eq_ignore_ascii_case("DIRECT"))
                    && bundles::owner(&r.id, &eff.bundles).is_none()
                {
                    if let Some(p) = crate::capture::user_mode::process_rule_port(&eff, r) {
                        ports.push(p);
                    }
                }
            }
        }
        let previous = old.effective();
        let active_reject = |effective: &Overrides, rule: &ProcessRule| {
            effective.process_enabled && rule.enabled && rule.action == "reject"
                && !bundles::owner(&rule.id, &effective.bundles).is_some_and(|bundle| !bundle.enabled)
        };
        let withdrawn = previous.process_rules.iter().filter(|rule| active_reject(&previous, rule))
            .any(|rule| !eff.process_rules.iter().any(|next| next == rule && active_reject(&eff, next)));
        crate::capture::user_mode::control::retain_core(&ports, withdrawn);
        if old.bundles_enabled && !config.bundles_enabled {
            let mut errors = Vec::new();
            let closed = tokio::time::timeout(std::time::Duration::from_secs(10), crate::commands::mihomo_api::close_withdrawn_bundle_connections(&old)).await
                .map_err(|_| "旧业务连接清理超时".to_string()).and_then(|r| r);
            if let Err(error) = closed { errors.push(error); }
            // Attempt DNS cleanup even when a controller connection failed.
            match crate::commands::dns_adapter::restore_bundle_dns_guard_locked().await {
                Ok(true) => if let Err(error) = reapply(&config).await { errors.push(format!("公共 DNS 运行状态未确认：{error}")); },
                Ok(false) => {},
                Err(error) => errors.push(format!("业务包托管的 DNS 护航恢复失败：{error}")),
            }
            if !errors.is_empty() { return Err(format!("业务规则与接管已撤销，但清理尚未全部确认：{}；请正常重启相关应用", errors.join("；"))); }
        }
        Ok(SaveNotice { hot_reset: hot_reset::applied(hot_reset).await })
    }
    #[cfg(not(windows))]
    Ok(SaveNotice::default())
}
