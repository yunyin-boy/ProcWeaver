use super::{path, read, valid_entry, Context, Entry, Group, ProfileGroups};
use crate::commands::{mihomo_api, process};
use mihomo_api::DelayResult;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;
use tokio::{sync::Notify, task::JoinSet};

mod schedule;
pub(super) use schedule::{check_status, CheckStatus};
use schedule::{schedules, Scope};

pub(super) const DEFAULT_URL: &str = "http://www.gstatic.com/generate_204";
const TEST_TIMEOUT_MS: u64 = 4_000;
const CONCURRENCY: usize = 6;
const MAX_NODES: usize = 4096;
const VALID_FOR: Duration = Duration::from_secs(120);
const AUTO_INTERVAL: Duration = Duration::from_secs(10);
pub(crate) const EVENT: &str = "procweaver-policy-groups-changed";

fn default_interval_minutes() -> u8 {
    2
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Conditions {
    pub(super) regions: Vec<String>,
    pub(super) keywords: Vec<String>,
    pub(super) protocols: Vec<String>,
    pub(super) max_multiplier: Option<f64>,
    pub(super) max_delay_ms: Option<u32>,
    #[serde(default = "default_interval_minutes")]
    check_interval_minutes: u8,
}

impl Conditions {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.regions.len() > 64
            || self
                .regions
                .iter()
                .any(|code| code.len() != 2 || !code.bytes().all(|byte| byte.is_ascii_uppercase()))
        {
            return Err("国家或地区选项无效".into());
        }
        if [&self.keywords, &self.protocols].into_iter().any(|items| {
            items.len() > 64
                || items
                    .iter()
                    .any(|value| !valid_entry(value) || value.len() > 160)
        }) {
            return Err("名称关键词或协议选项无效".into());
        }
        if self
            .max_multiplier
            .is_some_and(|value| !value.is_finite() || !(0.0..=10000.0).contains(&value))
            || self
                .max_delay_ms
                .is_some_and(|delay| !(1..=TEST_TIMEOUT_MS as u32).contains(&delay))
        {
            return Err("倍率或延迟上限超出范围".into());
        }
        if !matches!(self.check_interval_minutes, 2 | 5 | 15 | 30) {
            return Err("定时检测周期无效".into());
        }
        Ok(())
    }

    fn matches(&self, entry: &Entry) -> bool {
        let Some(node) = &entry.node else {
            return false;
        };
        let label = entry.label.to_lowercase();
        (self.regions.is_empty() || self.regions.contains(&node.region))
            && (self.keywords.is_empty()
                || self
                    .keywords
                    .iter()
                    .any(|word| label.contains(&word.trim().to_lowercase())))
            && (self.protocols.is_empty()
                || self
                    .protocols
                    .iter()
                    .any(|protocol| protocol.eq_ignore_ascii_case(&node.protocol)))
            && self.max_multiplier.is_none_or(|max| node.multiplier <= max)
    }

    fn allows(&self, delay: u32) -> bool {
        self.max_delay_ms.is_none_or(|max| delay <= max)
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AutoMember {
    pub(super) name: String,
    pub(super) identity: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Node {
    pub(super) region: String,
    region_name: String,
    pub(super) protocol: String,
    multiplier: f64,
    #[serde(skip)]
    pub(super) identity: String,
}

#[derive(Deserialize)]
struct LabelRule {
    code: String,
    name: String,
    pattern: String,
}
#[derive(Deserialize)]
struct LabelFile {
    regions: Vec<LabelRule>,
    multipliers: Vec<String>,
}
struct Labels {
    regions: Vec<(String, String, Regex)>,
    multipliers: Vec<Regex>,
}
static LABELS: OnceLock<Labels> = OnceLock::new();

fn labels() -> &'static Labels {
    LABELS.get_or_init(|| {
        let data: LabelFile =
            serde_json::from_str(include_str!("../../../../src/data/nodeRecognition.json"))
                .expect("bundled node recognition rules");
        let compile = |pattern: &str| {
            RegexBuilder::new(pattern)
                .case_insensitive(true)
                .build()
                .expect("bundled node recognition pattern")
        };
        Labels {
            regions: data
                .regions
                .into_iter()
                .map(|rule| (rule.code, rule.name, compile(&rule.pattern)))
                .collect(),
            multipliers: data
                .multipliers
                .iter()
                .map(|pattern| compile(pattern))
                .collect(),
        }
    })
}

fn flag_region(label: &str) -> Option<String> {
    let mut previous = None;
    for letter in label.chars() {
        let value = letter as u32;
        if (0x1f1e6..=0x1f1ff).contains(&value) {
            let code = char::from(b'A' + (value - 0x1f1e6) as u8);
            if let Some(first) = previous {
                let flag = String::from_iter([first, code]);
                return (!matches!(flag.as_str(), "EU" | "UN")).then_some(flag);
            }
            previous = Some(code);
        } else {
            previous = None;
        }
    }
    None
}

pub(super) fn identity(value: &Value) -> Option<String> {
    let definition = serde_yaml::to_string(value).ok()?;
    Some(format!("{:x}", Sha256::digest(definition.as_bytes())))
}

pub(super) fn node(value: &Value, label: &str) -> Option<Node> {
    let raw_type = value["type"].as_str()?.to_ascii_lowercase();
    let protocol = match raw_type.as_str() {
        "ss" | "shadowsocks" => "SS".into(),
        "hy2" | "hysteria2" => "HY2".into(),
        "hy" | "hysteria" => "HY".into(),
        "wg" | "wireguard" => "WG".into(),
        "direct" | "reject" | "pass" | "dns" | "compatible" => return None,
        _ => raw_type.to_ascii_uppercase(),
    };
    let rules = labels();
    let (region, region_name) = if let Some(code) = flag_region(label) {
        let name = rules
            .regions
            .iter()
            .find(|(value, _, _)| value == &code)
            .map_or_else(|| code.clone(), |(_, name, _)| name.clone());
        (code, name)
    } else {
        rules
            .regions
            .iter()
            .find(|(_, _, pattern)| pattern.is_match(label))
            .map_or_else(
                || ("".into(), "地区未知".into()),
                |(code, name, _)| (code.clone(), name.clone()),
            )
    };
    let multiplier = rules
        .multipliers
        .iter()
        .find_map(|pattern| {
            pattern
                .captures(label)?
                .get(1)?
                .as_str()
                .parse::<f64>()
                .ok()
        })
        .filter(|value| value.is_finite())
        .unwrap_or(1.0);
    Some(Node {
        region,
        region_name,
        protocol,
        multiplier,
        identity: identity(value)?,
    })
}

pub(super) fn validate_url(url: &str) -> Result<(), String> {
    if url.len() > 2048 {
        return Err("测速地址过长".into());
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| "测速地址无效")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("测速地址须为有效的 HTTP 或 HTTPS 地址".into());
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum Reading {
    Delay(DelayResult),
    Unavailable,
}

#[derive(Clone, Copy)]
struct Sample {
    value: Reading,
    measured: Instant,
    expires_at: u64,
}
impl Sample {
    fn observed(value: Reading) -> Self {
        Self {
            value,
            measured: Instant::now(),
            expires_at: (SystemTime::now() + VALID_FOR).duration_since(UNIX_EPOCH)
                .unwrap_or_default().as_millis() as u64,
        }
    }
    fn age(&self) -> Duration {
        self.measured.elapsed()
    }
    fn fresh(&self) -> bool {
        self.age() < VALID_FOR
    }
    fn delay(&self) -> Option<u32> {
        if self.fresh() {
            if let Reading::Delay(DelayResult::Passed(delay)) = self.value {
                return Some(delay);
            }
        }
        None
    }
}

#[derive(Eq, Hash, PartialEq)]
struct SampleKey {
    profile: String,
    url: String,
    identity: String,
}
type Samples = HashMap<SampleKey, Sample>;
static SAMPLES: OnceLock<Mutex<Samples>> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(0);
static MEASURE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static WAKE: Notify = Notify::const_new();

fn cache() -> std::sync::MutexGuard<'static, Samples> {
    SAMPLES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
fn key(profile: &str, url: &str, node: &Node) -> SampleKey {
    SampleKey {
        profile: profile.into(),
        url: url.into(),
        identity: node.identity.clone(),
    }
}

pub(crate) fn configuration_reloaded() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}
pub(crate) fn wake() {
    WAKE.notify_one();
}

pub(super) fn groups_saved(profile: &str, groups: &[Group]) {
    schedules().retain_saved(profile, groups);
    wake();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProbeView {
    name: String,
    status: &'static str,
    delay_ms: Option<u32>,
    expires_at: u64,
}
impl ProbeView {
    fn from_sample(name: &str, result: &Sample) -> Self {
        let status = match result.value {
            Reading::Delay(DelayResult::Passed(_)) if result.fresh() => "passed",
            Reading::Delay(DelayResult::Passed(_)) => "expired",
            Reading::Delay(DelayResult::Timeout) => "timeout",
            Reading::Delay(DelayResult::Failed) => "failed",
            Reading::Unavailable => "unavailable",
        };
        Self {
            name: name.into(),
            status,
            delay_ms: result.delay(),
            expires_at: result.expires_at,
        }
    }
}

pub(super) fn view(profile: &str, url: &str, entries: &[Entry]) -> Vec<ProbeView> {
    let samples = cache();
    entries
        .iter()
        .filter_map(|entry| {
            let node = entry.node.as_ref()?;
            let result = samples.get(&key(profile, url, node))?;
            Some(ProbeView::from_sample(&entry.name, result))
        })
        .collect()
}

pub(super) fn verified(profile: &str, url: &str, entry: &Entry) -> bool {
    entry.node.as_ref().is_some_and(|node| {
        cache()
            .get(&key(profile, url, node))
            .and_then(Sample::delay)
            .is_some()
    })
}

struct ProbeContext {
    profile: String,
    pid: u32,
    generation: u64,
}
impl ProbeContext {
    fn new(profile: &str) -> Self {
        Self {
            profile: profile.into(),
            pid: process::PID.load(Ordering::SeqCst),
            generation: GENERATION.load(Ordering::SeqCst),
        }
    }
    fn current(&self) -> bool {
        self.generation == GENERATION.load(Ordering::SeqCst)
            && self.pid == process::PID.load(Ordering::SeqCst)
            && process::ACTIVE.load(Ordering::SeqCst)
            && self.profile == super::super::current_source().0
    }
}

async fn measure(url: &str, entries: &[Entry]) -> Result<Vec<Sample>, String> {
    let client = mihomo_api::controller_client()
        .timeout(Duration::from_millis(TEST_TIMEOUT_MS + 1500))
        .build()
        .map_err(|_| "无法连接核心测速接口")?;
    let base = mihomo_api::base_url()?;
    let mut running = JoinSet::new();
    let start = |running: &mut JoinSet<_>, index: usize| {
        let (client, base, name, url) = (
            client.clone(),
            base.clone(),
            entries[index].name.clone(),
            url.to_owned(),
        );
        running.spawn(async move {
            let result = mihomo_api::request_delay(
                &client,
                &base,
                &name,
                &url,
                TEST_TIMEOUT_MS,
                Some("200/204"),
            )
            .await;
            (index, Sample::observed(result.map_or(Reading::Unavailable, Reading::Delay)))
        });
    };
    let mut indices = 0..entries.len();
    for index in indices.by_ref().take(CONCURRENCY) {
        start(&mut running, index);
    }
    let mut results = vec![Sample::observed(Reading::Unavailable); entries.len()];
    while let Some(result) = running.join_next().await {
        let (index, reading) = result.map_err(|_| "节点测速任务中断")?;
        results[index] = reading;
        if let Some(next) = indices.next() {
            start(&mut running, next);
        }
    }
    Ok(results)
}

fn record(profile: &str, url: &str, entries: &[Entry], results: &[Sample]) {
    let mut samples = cache();
    samples.retain(|_, value| value.age() < Duration::from_secs(900));
    for (entry, sample) in entries.iter().zip(results) {
        if let Some(node) = &entry.node {
            samples.insert(key(profile, url, node), *sample);
        }
    }
}

fn eligible<'a>(group: &'a Group, entries: &'a [Entry]) -> impl Iterator<Item = (&'a Entry, &'a Node)> {
    let manual: HashSet<_> = group.members.iter().map(String::as_str).collect();
    entries.iter().filter_map(move |entry| {
        let node = entry.node.as_ref()?;
        (group.automatic.as_ref().is_some_and(|conditions| conditions.matches(entry))
            && !manual.contains(entry.name.as_str())).then_some((entry, node))
    })
}

pub(super) fn update_members_on_save(
    profile_id: &str,
    url: &str,
    profile: &mut ProfileGroups,
    entries: &[Entry],
    edited: &str,
) {
    let Some(group) = profile.groups.iter().find(|group| group.name == edited) else {
        profile.automatic_members.remove(edited);
        return;
    };
    let Some(conditions) = &group.automatic else {
        profile.automatic_members.remove(edited);
        return;
    };
    let matched: Vec<_> = eligible(group, entries).collect();
    let identities: HashSet<_> = matched.iter().map(|(_, node)| node.identity.as_str()).collect();
    let members = profile.automatic_members.entry(edited.into()).or_default();
    members.retain(|member| identities.contains(member.identity.as_str()));
    let existing: HashSet<_> = members.iter().map(|member| member.identity.clone()).collect();
    let samples = cache();
    let capacity = MAX_NODES.saturating_sub(group.members.len());
    members.truncate(capacity);
    let remaining = capacity - members.len();
    members.extend(matched.into_iter().filter(|(_, node)| {
        !existing.contains(&node.identity)
            && samples.get(&key(profile_id, url, node)).and_then(Sample::delay)
                .is_some_and(|delay| conditions.allows(delay))
    }).take(remaining).map(|(entry, node)| AutoMember {
        name: entry.name.clone(),
        identity: node.identity.clone(),
    }));
    if members.is_empty() {
        profile.automatic_members.remove(edited);
    }
}

#[tauri::command]
pub(crate) async fn test_policy_group_nodes(
    profile_id: String,
    names: Vec<String>,
    test_url: String,
) -> Result<Vec<ProbeView>, String> {
    crate::function_mode::require_full()?;
    validate_url(&test_url)?;
    if names.is_empty() || names.len() > MAX_NODES {
        return Err("请选择需要测速的节点".into());
    }
    let requested: HashSet<_> = names.into_iter().collect();
    let _probe = MEASURE.lock().await;
    let (scope, nodes) = {
        let _lock = process::LIFECYCLE.lock().await;
        if !process::ACTIVE.load(Ordering::SeqCst) {
            return Err("请先启动核心再测速".into());
        }
        let context = Context::load()?;
        if context.id != profile_id {
            return Err("当前方案已变更，请重新打开策略组".into());
        }
        let nodes: Vec<_> = context
            .catalog(&read()?)?
            .into_iter()
            .filter(|entry| entry.node.is_some() && requested.contains(&entry.name))
            .collect();
        if nodes.len() != requested.len() {
            return Err("部分节点已变化，请刷新候选列表".into());
        }
        (ProbeContext::new(&profile_id), nodes)
    };
    let results = measure(&test_url, &nodes).await?;
    let _lock = process::LIFECYCLE.lock().await;
    if !scope.current() {
        return Err("测速期间运行配置已变化，请重测".into());
    }
    record(&profile_id, &test_url, &nodes, &results);
    Ok(view(&profile_id, &test_url, &nodes))
}

#[tauri::command]
pub(crate) async fn set_policy_group_test_url(test_url: String) -> Result<(), String> {
    let _lock = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    validate_url(&test_url)?;
    let mut store = read()?;
    if store.test_url() != test_url {
        store.test_url = Some(test_url);
        crate::storage::replace_atomic(&path(), &store.encode()?)?;
    }
    wake();
    Ok(())
}

#[tauri::command]
pub(crate) async fn check_policy_group_now(profile_id: String, name: String) -> Result<(), String> {
    let _lock = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    if !process::ACTIVE.load(Ordering::SeqCst) || crate::shutdown::in_progress() {
        return Err("请先启动核心再检测".into());
    }
    if super::super::current_source().0 != profile_id {
        return Err("当前方案已变更，请重新打开策略组".into());
    }
    let store = read()?;
    let (group, conditions) = store.groups(&profile_id).iter()
        .find(|group| group.name == name)
        .and_then(|group| Some((group, group.automatic.as_ref()?)))
        .ok_or("该策略组未启用自动入组")?;
    let scope = Scope::new(&profile_id, store.test_url(), process::PID.load(Ordering::SeqCst));
    schedules().request(scope, group, conditions);
    wake();
    Ok(())
}

async fn sweep(app: &tauri::AppHandle) -> Result<bool, String> {
    let Ok(_probe) = MEASURE.try_lock() else {
        return Ok(false);
    };
    let (scope, test_url, batch) = {
        let _lock = process::LIFECYCLE.lock().await;
        if !process::ACTIVE.load(Ordering::SeqCst) || crate::shutdown::in_progress() {
            return Ok(false);
        }
        let (id, _) = super::super::current_source();
        let store = read()?;
        let Some(profile) = store
            .profiles
            .get(&id)
            .filter(|p| p.groups.iter().any(|group| group.automatic.is_some()))
        else {
            return Ok(false);
        };
        let context = Context::load()?;
        let entries = context.catalog(&store)?;
        let test_url = store.test_url().to_owned();
        let scope = ProbeContext::new(&id);
        let batch = schedules().prepare(Scope::new(&id, &test_url, scope.pid), profile, &entries);
        (scope, test_url, batch)
    };
    if batch.started {
        let _ = app.emit(EVENT, ());
    }
    if batch.entries.is_empty() && !batch.ready {
        return Ok(false);
    }
    let results = if batch.entries.is_empty() {
        Vec::new()
    } else {
        measure(&test_url, &batch.entries).await.unwrap_or_else(|error| {
            eprintln!("策略组测速失败：{error}");
            vec![Sample::observed(Reading::Unavailable); batch.entries.len()]
        })
    };
    let _lock = process::LIFECYCLE.lock().await;
    if !scope.current() || crate::shutdown::in_progress() {
        wake();
        return Ok(false);
    }
    let context = Context::load()?;
    let mut store = read()?;
    if store.test_url() != test_url {
        wake();
        return Ok(false);
    }
    record(&scope.profile, &test_url, &batch.entries, &results);
    let entries = context.catalog(&store)?;
    let Some(profile) = store.profiles.get_mut(&scope.profile) else {
        return Ok(false);
    };
    let (completed, changed) = {
        let mut state = schedules();
        state.record(&batch.entries, &results);
        state.propose(profile, &entries)
    };
    let error = if changed {
        async {
            let config = super::super::read()?;
            super::apply_candidate(&context, &config, &store, &store.encode()?).await
        }.await.err()
    } else {
        None
    };
    if let Some(error) = &error {
        eprintln!("自动更新策略组成员失败：{error}");
    }
    let updated = !completed.is_empty();
    schedules().finish(completed, error);
    if batch.more {
        wake();
    }
    Ok(updated)
}

pub(crate) async fn run(app: tauri::AppHandle) {
    loop {
        let interval = schedules().until_next().filter(|delay| !delay.is_zero())
            .map_or(AUTO_INTERVAL, |delay| AUTO_INTERVAL.min(delay));
        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = WAKE.notified() => {}
        }
        if !crate::function_mode::core_features_enabled() {
            continue;
        }
        match sweep(&app).await {
            Ok(true) => {
                let _ = app.emit(EVENT, ());
            }
            Ok(false) => {}
            Err(error) => eprintln!("自动更新策略组成员失败：{error}"),
        }
    }
}
