use super::{bundles, composer, model, process};
use crate::{local_nodes, storage};
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::{collections::HashSet, fs, net::IpAddr, path::PathBuf, sync::atomic::Ordering};

pub(crate) const CONFIG_FILE: &str = "config/custom-routing-rules.json";
const MAX_RULES: usize = 2000;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const NESTED: &[&str] = &["AND", "OR", "NOT"];
const MATCH_KINDS: &[&str] = &[
    "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "DOMAIN-REGEX", "DOMAIN-WILDCARD",
    "IP-CIDR", "IP-CIDR6", "SRC-IP-CIDR", "IP-SUFFIX", "SRC-IP-SUFFIX",
    "GEOIP", "SRC-GEOIP", "GEOSITE", "IP-ASN", "SRC-IP-ASN", "RULE-SET",
    "DST-PORT", "SRC-PORT", "IN-PORT", "NETWORK", "DSCP", "UID",
    "IN-TYPE", "IN-USER", "IN-NAME", "REMATCH-NAME",
    "PROCESS-NAME", "PROCESS-PATH", "PROCESS-NAME-REGEX", "PROCESS-PATH-REGEX",
    "PROCESS-NAME-WILDCARD", "PROCESS-PATH-WILDCARD", "AND", "OR", "NOT",
];

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Condition {
    kind: String,
    value: String,
    options: Vec<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Action {
    Direct,
    Reject,
    Outlet { target: model::Target },
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Rule {
    id: String,
    profile_id: Option<String>,
    enabled: bool,
    condition: Condition,
    action: Action,
}

impl Rule {
    fn applies_to(&self, profile_id: &str) -> bool {
        self.profile_id.as_deref().is_none_or(|scope| scope == profile_id)
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Store {
    revision: u64,
    rules: Vec<Rule>,
}

fn path() -> PathBuf {
    storage::data_dir().join(CONFIG_FILE)
}

pub(super) fn read() -> Result<Store, String> {
    match fs::read(path()) {
        Ok(bytes) => parse_store(&bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(_) => Err("无法读取自定义分流规则".into()),
    }
}

pub(crate) fn validate_snapshot(bytes: &[u8]) -> Result<(), String> {
    parse_store(bytes).map(drop)
}

pub(super) fn outlet_references(target: &model::Target) -> Result<Vec<String>, String> {
    Ok(read()?.rules.into_iter().filter_map(|rule| match rule.action {
        Action::Outlet { target: bound } if &bound == target => Some(format!("自定义规则「{}」", rule.condition.value)),
        _ => None,
    }).collect())
}

fn parse_store(bytes: &[u8]) -> Result<Store, String> {
    if bytes.len() > MAX_BYTES {
        return Err("自定义规则文件过大".into());
    }
    let mut store: Store = serde_json::from_slice(bytes).map_err(|_| "自定义规则格式无效")?;
    normalize(&mut store.rules)?;
    Ok(store)
}

fn normalize(rules: &mut [Rule]) -> Result<(), String> {
    if rules.len() > MAX_RULES {
        return Err(format!("自定义规则最多 {MAX_RULES} 条"));
    }
    let mut ids = HashSet::new();
    for rule in rules {
        if rule.id.is_empty() || rule.id.len() > 80
            || !rule.id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
            || !ids.insert(rule.id.clone())
        {
            return Err("自定义规则标识无效或重复".into());
        }
        if rule.profile_id.as_deref().is_some_and(|id| !model::safe_atom(id)) {
            return Err("自定义规则所属方案无效".into());
        }
        if let Action::Outlet { target } = &rule.action {
            let Some(profile_id) = &rule.profile_id else {
                return Err("所有方案仅支持直连或拒绝".into());
            };
            if !model::safe_atom(&target.name) || !matches!(target.kind.as_str(), "node" | "group")
                || (&target.profile_id != profile_id
                    && !(target.profile_id == local_nodes::SOURCE && target.kind == "node"))
            {
                return Err("指定出口必须属于该方案".into());
            }
        }
        rule.condition.normalize()?;
    }
    Ok(())
}

impl Condition {
    fn normalize(&mut self) -> Result<(), String> {
        self.kind = self.kind.trim().to_ascii_uppercase();
        self.value = self.value.trim().to_owned();
        if !MATCH_KINDS.contains(&self.kind.as_str()) || self.value.is_empty()
            || self.value.len() > 2048 || self.value.chars().any(char::is_control)
            || (!NESTED.contains(&self.kind.as_str()) && !self.kind.ends_with("-REGEX")
                && self.value.contains(','))
        {
            return Err("规则类型或匹配条件无效".into());
        }
        if self.options.len() > 4 || self.options.iter().any(|opt| !matches!(opt.as_str(), "no-resolve" | "src")) {
            return Err("不支持该规则的附加选项".into());
        }
        match self.kind.as_str() {
            "DOMAIN" | "DOMAIN-SUFFIX" => {
                self.value.make_ascii_lowercase();
                let bare = self.value.len() <= 63 && !self.value.starts_with('-') && !self.value.ends_with('-')
                    && self.value.bytes().all(|ch| ch.is_ascii_alphanumeric() || ch == b'-');
                if !bare && !model::domain(&self.value) {
                    return Err("请输入域名或域名后缀，国际化域名使用 Punycode".into());
                }
            }
            "IP-CIDR" | "IP-CIDR6" | "SRC-IP-CIDR" => {
                let (ip, prefix) = self.value.split_once('/').ok_or("请输入带前缀长度的 IP 网段")?;
                let ip: IpAddr = ip.parse().map_err(|_| "IP 网段地址无效")?;
                let prefix: u8 = prefix.parse().map_err(|_| "IP 网段前缀无效")?;
                if prefix > if ip.is_ipv4() { 32 } else { 128 } {
                    return Err("IP 网段前缀超出范围".into());
                }
                if self.kind != "SRC-IP-CIDR" {
                    self.kind = if ip.is_ipv4() { "IP-CIDR" } else { "IP-CIDR6" }.into();
                }
                self.value = format!("{ip}/{prefix}");
            }
            "DST-PORT" | "SRC-PORT" | "IN-PORT" => {
                if !self.value.split('/').all(|item| {
                    let (low, high) = item.split_once('-').unwrap_or((item, item));
                    matches!((low.parse::<u16>(), high.parse::<u16>()),
                        (Ok(low), Ok(high)) if low > 0 && low <= high)
                }) {
                    return Err("请输入 1–65535 的端口或端口范围".into());
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn missing_provider(&self, yaml: &Value) -> bool {
        let available = |name: &str| yaml["rule-providers"].get(name).is_some();
        if self.kind == "RULE-SET" {
            return !available(&self.value);
        }
        if !NESTED.contains(&self.kind.as_str()) {
            return false;
        }
        let mut parts = self.value.split(',');
        while let Some(part) = parts.next() {
            if part.trim_start().trim_start_matches('(').trim().eq_ignore_ascii_case("RULE-SET")
                && parts.next().is_none_or(|next| !available(next.trim().trim_end_matches(')').trim_end()))
            {
                return true;
            }
        }
        false
    }

    fn expression(&self, outbound: &str) -> String {
        let mut line = format!("{},{},{outbound}", self.kind, self.value);
        for opt in &self.options {
            line.push(',');
            line.push_str(opt);
        }
        line
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum Availability {
    Ready,
    MissingOutlet,
    MissingRuleSet,
}

fn resolved_outlet<'a>(action: &'a Action, available: &[model::Target], profile_id: &str) -> Option<&'a str> {
    match action {
        Action::Direct => Some("DIRECT"),
        Action::Reject => Some("REJECT"),
        Action::Outlet { target } => {
            let mut binding = target.clone();
            local_nodes::remap(&mut binding, profile_id);
            available.contains(&binding).then_some(target.name.as_str())
        }
    }
}

fn availability(rule: &Rule, yaml: &Value, available: &[model::Target], profile_id: &str) -> Availability {
    if rule.condition.missing_provider(yaml) {
        Availability::MissingRuleSet
    } else if resolved_outlet(&rule.action, available, profile_id).is_none() {
        Availability::MissingOutlet
    } else {
        Availability::Ready
    }
}

pub(super) fn compose(raw: &str, profile_id: &str, store: &Store, after: usize) -> Result<String, String> {
    let enabled = store.rules.iter().filter(|rule| rule.enabled && rule.applies_to(profile_id));
    if enabled.clone().next().is_none() {
        return Ok(raw.into());
    }
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "读取自定义规则上下文失败")?;
    let targets = composer::targets(raw, profile_id)?;
    let lines: Vec<Value> = enabled
        .filter(|rule| !rule.condition.missing_provider(&yaml))
        .map(|rule| {
            let outbound = resolved_outlet(&rule.action, &targets, profile_id).unwrap_or("REJECT");
            Value::from(rule.condition.expression(outbound))
        })
        .collect();
    if lines.is_empty() {
        return Ok(raw.into());
    }
    let rules = yaml.as_mapping_mut().ok_or("配置须为对象")?
        .entry("rules".into()).or_insert_with(|| Value::Sequence(Vec::new()))
        .as_sequence_mut().ok_or("rules 须为数组")?;
    if after > rules.len() {
        return Err("无法定位自定义规则的匹配顺序".into());
    }
    rules.splice(after..after, lines);
    serde_yaml::to_string(&yaml).map_err(|_| "无法合成自定义规则".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceRule {
    order: usize,
    expression: String,
    copy: Option<CopyRule>,
}

#[derive(Serialize)]
struct CopyRule {
    condition: Condition,
    action: Option<Action>,
}

#[derive(Clone, Serialize)]
struct Outlet {
    label: String,
    target: model::Target,
}

fn copy_rule(expression: &str, outlets: &[Outlet]) -> Option<CopyRule> {
    let (kind, matcher, outbound, options) = bundles::existing_rule_parts(expression)?;
    let value = matcher.split_once(',')?.1.strip_suffix(',')?;
    let mut condition = Condition {
        kind: kind.into(),
        value: value.into(),
        options: options.split(',').skip(1).map(|part| part.trim().to_ascii_lowercase()).collect(),
    };
    condition.normalize().ok()?;
    let action = match outbound {
        "DIRECT" => Some(Action::Direct),
        "REJECT" => Some(Action::Reject),
        name => outlets.iter().find(|outlet| outlet.target.name == name)
            .map(|outlet| Action::Outlet { target: outlet.target.clone() }),
    };
    Some(CopyRule { condition, action })
}

struct Context {
    profile_id: String,
    profile_name: String,
    source_label: &'static str,
    source: String,
    original: Value,
    base: Value,
    targets: Vec<model::Target>,
    outlets: Vec<Outlet>,
    nodes: local_nodes::Store,
}

impl Context {
    fn load() -> Result<Self, String> {
        let (profile_id, file) = super::current_source();
        let item = super::profile::read_profiles_index().into_iter().find(|profile| profile.id == profile_id);
        let source_label = if item.as_ref().is_some_and(|profile| profile.url.starts_with("http")) {
            "订阅规则"
        } else {
            "本地方案规则"
        };
        let profile_name = item.map_or_else(|| "本地默认方案".into(), |profile| profile.name);
        let source = fs::read_to_string(file).map_err(|_| "读取当前方案失败")?;
        let original = serde_yaml::from_str(&source).map_err(|_| "当前方案 YAML 无效")?;
        let nodes = local_nodes::read()?;
        let base = super::prepare_profile_base(&source, &super::settings::get_general_settings()?, &nodes)?;
        let base = super::policy_groups::project_outlets(&base, &profile_id, &super::policy_groups::read()?)?;
        let targets = composer::targets(&base, &profile_id)?;
        let outlets = targets.iter().map(|target| {
            if let Some(node) = nodes.nodes.iter().find(|node| node.alias() == target.name) {
                Outlet { label: format!("{} · 本地", node.name), target: node.target() }
            } else {
                Outlet { label: target.name.clone(), target: target.clone() }
            }
        }).collect();
        let base = serde_yaml::from_str(&base).map_err(|_| "当前方案出口无效")?;
        Ok(Self { profile_id, profile_name, source_label, source, original, base, targets, outlets, nodes })
    }

    fn availability(&self, rule: &Rule) -> Availability {
        availability(rule, &self.base, &self.targets, &self.profile_id)
    }

    fn view(&self, store: &Store) -> Workbench {
        let rules = store.rules.iter().filter(|rule| rule.applies_to(&self.profile_id))
            .map(|rule| RuleRow { rule: rule.clone(), availability: self.availability(rule) })
            .collect();
        let source_rules = self.original["rules"].as_sequence().into_iter().flatten().enumerate()
            .filter_map(|(index, value)| {
                let expression = value.as_str()?;
                Some(SourceRule { order: index + 1, expression: expression.into(),
                    copy: copy_rule(expression, &self.outlets) })
            }).collect();
        Workbench {
            revision: store.revision,
            profile_id: self.profile_id.clone(),
            profile_name: self.profile_name.clone(),
            source_label: self.source_label,
            rules,
            source_rules,
            outlets: self.outlets.clone(),
            running: process::ACTIVE.load(Ordering::SeqCst),
        }
    }
}

#[derive(Serialize)]
struct RuleRow {
    #[serde(flatten)]
    rule: Rule,
    availability: Availability,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Workbench {
    revision: u64,
    profile_id: String,
    profile_name: String,
    source_label: &'static str,
    rules: Vec<RuleRow>,
    source_rules: Vec<SourceRule>,
    outlets: Vec<Outlet>,
    running: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveRequest {
    revision: u64,
    profile_id: String,
    rules: Vec<Rule>,
}

#[tauri::command]
pub(crate) async fn get_custom_rule_workbench() -> Result<Workbench, String> {
    let _lock = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    Ok(Context::load()?.view(&read()?))
}

#[tauri::command]
pub(crate) async fn save_custom_rules(mut request: SaveRequest) -> Result<Workbench, String> {
    let _lock = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    if crate::shutdown::in_progress() {
        return Err("正在退出，暂不能保存规则".into());
    }
    let mut store = read()?;
    let context = Context::load()?;
    if store.revision != request.revision || context.profile_id != request.profile_id {
        return Err("当前方案或自定义规则已变更，请刷新后重试".into());
    }
    if request.rules.iter().any(|rule| !rule.applies_to(&context.profile_id)) {
        return Err("只能编辑当前方案及所有方案的自定义规则".into());
    }
    normalize(&mut request.rules)?;
    for rule in request.rules.iter().filter(|rule| rule.enabled && !store.rules.contains(rule)) {
        match context.availability(rule) {
            Availability::Ready => {}
            Availability::MissingOutlet => return Err("指定出口已不可用，请重新选择".into()),
            Availability::MissingRuleSet => return Err("当前方案缺少规则引用的规则集".into()),
        }
    }
    // Replace the visible slots in order and carry inactive profiles forward.
    let mut changed = request.rules.into_iter();
    let mut merged: Vec<Rule> = store.rules.into_iter().filter_map(|rule| {
        if rule.applies_to(&context.profile_id) { changed.next() } else { Some(rule) }
    }).collect();
    merged.extend(changed);
    normalize(&mut merged)?;
    store.rules = merged;
    store.revision = store.revision.checked_add(1).ok_or("规则修订号已耗尽")?;
    let bytes = serde_json::to_vec_pretty(&store).map_err(|_| "无法保存自定义规则")?;
    if bytes.len() > MAX_BYTES {
        return Err("自定义规则文件过大".into());
    }

    let overrides = super::read()?;
    let prepared = super::prepare_with_rule_store(&context.source, &overrides, &context.profile_id, &context.nodes, &store)?;
    super::profile::validate_config(&prepared)?;
    let old_runtime = if process::ACTIVE.load(Ordering::SeqCst) {
        let old = fs::read_to_string(storage::data_dir().join("core_data/config.yaml"))
            .map_err(|_| "读取原运行配置失败")?;
        super::apply_runtime(&prepared).await?;
        Some(old)
    } else {
        None
    };
    if let Err(error) = storage::replace_atomic(&path(), &bytes) {
        if let Some(old) = old_runtime {
            super::apply_runtime(&old).await.map_err(|restore| format!("保存自定义规则失败：{error}；恢复失败：{restore}"))?;
        }
        return Err(format!("保存自定义规则失败，原规则已保留：{error}"));
    }
    Ok(context.view(&store))
}
