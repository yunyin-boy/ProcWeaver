use super::{composer, custom_rules, model, profile, settings};
use crate::{commands::process, local_nodes, storage};
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::PathBuf,
    sync::atomic::Ordering,
};

pub(crate) mod admission;
pub(crate) mod runtime;

pub(crate) const CONFIG_FILE: &str = "config/policy-groups.json";
const RUNTIME_KEY: &str = "procweaver-policy-group-selections";
pub(super) const ORIGIN_KEY: &str = "procweaver-custom-group";
const MAX_BYTES: usize = 4 * 1024 * 1024;
const ACTIONS: &[(&str, &str)] = &[("DIRECT", "直连"), ("REJECT", "拒绝")];
const RESERVED: &[&str] = &[
    "PROXY",
    "GLOBAL",
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "PASS",
    "COMPATIBLE",
    "RULES",
    "DNS",
];

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Strategy {
    Select,
    UrlTest,
}
impl Strategy {
    fn as_str(self) -> &'static str {
        match self {
            Self::Select => "select",
            Self::UrlTest => "url-test",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Group {
    name: String,
    strategy: Strategy,
    members: Vec<String>,
    parents: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    automatic: Option<admission::Conditions>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProfileGroups {
    groups: Vec<Group>,
    selections: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    automatic_members: BTreeMap<String, Vec<admission::AutoMember>>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Store {
    revision: u64,
    profiles: BTreeMap<String, ProfileGroups>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    test_url: Option<String>,
}

fn path() -> PathBuf {
    storage::data_dir().join(CONFIG_FILE)
}

pub(super) fn read() -> Result<Store, String> {
    match fs::read(path()) {
        Ok(bytes) => parse(&bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(_) => Err("读取自建策略组失败".into()),
    }
}

pub(crate) fn managed() -> Result<bool, String> {
    Ok(read()?.revision != 0)
}

pub(crate) fn validate_snapshot(bytes: &[u8]) -> Result<(), String> {
    parse(bytes).map(drop)
}

fn valid_entry(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 1024 && !value.chars().any(char::is_control)
}

fn internal_name(name: &str) -> bool {
    name.starts_with("PW-") || name.starts_with("本地方案") || name.starts_with("procweaver-")
}

fn valid_name(name: &str) -> bool {
    name == name.trim()
        && name.len() <= 160
        && model::safe_atom(name)
        && !internal_name(name)
        && !RESERVED
            .iter()
            .any(|reserved| name.eq_ignore_ascii_case(reserved))
}

fn validate_group(group: &Group) -> Result<(), String> {
    if !valid_name(&group.name) {
        return Err("请输入有效的自建组名称，系统保留名称不可使用".into());
    }
    if (group.members.is_empty() && group.automatic.is_none())
        || group.members.len() > 4096
        || group.parents.len() > 128
    {
        return Err("策略组需有至少一个成员，成员或加入的上级组数量过多".into());
    }
    if let Some(conditions) = &group.automatic {
        conditions.validate()?;
    }
    for entries in [&group.members, &group.parents] {
        let mut seen = HashSet::new();
        if entries
            .iter()
            .any(|entry| !valid_entry(entry) || entry == &group.name || !seen.insert(entry))
        {
            return Err("策略组成员或上级组有重复、自引用或无效名称".into());
        }
    }
    Ok(())
}

fn check(store: &Store) -> Result<(), String> {
    if let Some(url) = &store.test_url {
        admission::validate_url(url)?;
    }
    if store.profiles.len() > 1024 || (store.revision == 0 && !store.profiles.is_empty()) {
        return Err("自建组方案存储无效".into());
    }
    for (id, profile) in &store.profiles {
        if !model::safe_atom(id) || profile.groups.len() > 128 || profile.selections.len() > 4096 {
            return Err("方案的自建策略组或手动选择数量无效".into());
        }
        let mut names = HashSet::new();
        for group in &profile.groups {
            validate_group(group)?;
            if !names.insert(group.name.to_lowercase()) {
                return Err("自建策略组名称重复".into());
            }
        }
        for (name, members) in &profile.automatic_members {
            let mut seen = HashSet::new();
            if !profile
                .groups
                .iter()
                .any(|group| &group.name == name && group.automatic.is_some())
                || members.len() > 4096
                || members.iter().any(|member| {
                    !valid_entry(&member.name)
                        || member.identity.len() != 64
                        || !member.identity.bytes().all(|byte| byte.is_ascii_hexdigit())
                        || !seen.insert(&member.name)
                })
            {
                return Err("自动入组记录无效".into());
            }
        }
        if profile.selections.iter().any(|(group, member)| {
            !valid_entry(group) || !valid_entry(member) || internal_name(group)
        }) {
            return Err("策略组选择记录无效".into());
        }
    }
    Ok(())
}

fn parse(bytes: &[u8]) -> Result<Store, String> {
    if bytes.len() > MAX_BYTES {
        return Err("自建策略组存储过大".into());
    }
    let store = serde_json::from_slice(bytes).map_err(|_| "自建策略组存储损坏")?;
    check(&store)?;
    Ok(store)
}

impl Store {
    fn test_url(&self) -> &str {
        self.test_url.as_deref().unwrap_or(admission::DEFAULT_URL)
    }

    fn advance(&mut self) -> Result<Vec<u8>, String> {
        self.revision = self.revision.checked_add(1).ok_or("策略组修订号已耗尽")?;
        self.encode()
    }

    fn encode(&self) -> Result<Vec<u8>, String> {
        check(self)?;
        let bytes = serde_json::to_vec_pretty(self).map_err(|_| "保存策略组失败")?;
        if bytes.len() > MAX_BYTES {
            return Err("自建策略组存储过大".into());
        }
        Ok(bytes)
    }

    fn groups(&self, profile_id: &str) -> &[Group] {
        self.profiles
            .get(profile_id)
            .map_or(&[], |profile| profile.groups.as_slice())
    }
}

fn yaml(raw: &str) -> Result<Value, String> {
    serde_yaml::from_str(raw).map_err(|_| "读取策略组配置失败".into())
}

fn render(value: &Value) -> Result<String, String> {
    serde_yaml::to_string(value).map_err(|_| "生成策略组配置失败".into())
}

fn names<'a>(yaml: &'a Value, section: &str) -> impl Iterator<Item = &'a str> {
    yaml[section]
        .as_sequence()
        .into_iter()
        .flatten()
        .filter_map(|item| item["name"].as_str())
}

fn groups_mut(yaml: &mut Value) -> Result<&mut Vec<Value>, String> {
    let groups = yaml
        .as_mapping_mut()
        .ok_or("策略组配置须为对象")?
        .entry("proxy-groups".into())
        .or_insert(Value::Null);
    if groups.is_null() {
        *groups = Value::Sequence(Vec::new());
    }
    groups
        .as_sequence_mut()
        .ok_or("proxy-groups 须为列表".into())
}

fn add_memberships(yaml: &mut Value, groups: &[Group]) -> Result<(), String> {
    for parent in groups_mut(yaml)? {
        if parent["type"].as_str() != Some("select") {
            continue;
        }
        let Some(name) = parent["name"].as_str() else {
            continue;
        };
        let children: Vec<_> = groups
            .iter()
            .filter(|group| group.parents.iter().any(|entry| entry == name))
            .map(|group| Value::from(group.name.as_str()))
            .collect();
        if children.is_empty() {
            continue;
        }
        let members = parent
            .as_mapping_mut()
            .ok_or("上级策略组无效")?
            .entry("proxies".into())
            .or_insert_with(|| Value::Sequence(Vec::new()))
            .as_sequence_mut()
            .ok_or("上级策略组成员须为列表")?;
        for child in children {
            if !members.contains(&child) {
                members.push(child);
            }
        }
    }
    Ok(())
}

fn check_cycles(yaml: &Value) -> Result<(), String> {
    let graph: BTreeMap<_, _> = yaml["proxy-groups"]
        .as_sequence()
        .into_iter()
        .flatten()
        .filter_map(|group| Some((group["name"].as_str()?, &group["proxies"])))
        .collect();
    let mut visited = HashSet::new();
    let mut visiting = HashSet::new();
    for name in graph.keys().copied() {
        let mut pending = vec![(name, false)];
        while let Some((group, expanded)) = pending.pop() {
            if expanded {
                visiting.remove(group);
                visited.insert(group);
            } else if !visited.contains(group) {
                if !visiting.insert(group) {
                    return Err(format!("策略组「{group}」存在循环引用，请调整成员或上级组"));
                }
                pending.push((group, true));
                if let Some(children) = graph.get(group).and_then(|members| members.as_sequence()) {
                    pending.extend(
                        children
                            .iter()
                            .filter_map(Value::as_str)
                            .filter(|child| graph.contains_key(child))
                            .map(|child| (child, false)),
                    );
                }
            }
        }
    }
    Ok(())
}

pub(super) fn project(raw: &str, profile_id: &str, store: &Store) -> Result<String, String> {
    let groups = store.groups(profile_id);
    if groups.is_empty() {
        return Ok(raw.into());
    }
    let mut yaml = yaml(raw)?;
    let names: HashSet<String> = names(&yaml, "proxies")
        .chain(names(&yaml, "proxy-groups"))
        .map(str::to_owned)
        .collect();
    let taken: HashSet<_> = names
        .iter()
        .map(|name| name.trim().to_lowercase())
        .collect();
    if let Some(group) = groups
        .iter()
        .find(|group| taken.contains(&group.name.to_lowercase()))
    {
        return Err(format!("当前方案已有名为「{}」的节点或策略组", group.name));
    }
    let mut members = names;
    members.extend(ACTIONS.iter().map(|(name, _)| String::from(*name)));
    members.extend(groups.iter().map(|group| group.name.clone()));
    if !composer::public_proxy_nodes(&yaml).is_empty() {
        members.insert("PROXY".into());
    }
    let automatic = &store.profiles[profile_id].automatic_members;
    let identities: BTreeMap<_, _> = if automatic.is_empty() {
        BTreeMap::new()
    } else {
        yaml["proxies"]
            .as_sequence()
            .into_iter()
            .flatten()
            .filter_map(|node| {
                Some((
                    node["name"].as_str()?.to_owned(),
                    admission::identity(node)?,
                ))
            })
            .collect()
    };
    let list = groups_mut(&mut yaml)?;
    for group in groups {
        let mut active: Vec<_> = group
            .members
            .iter()
            .filter(|name| members.contains(*name))
            .cloned()
            .collect();
        if let Some(added) = automatic.get(&group.name) {
            for member in added {
                if identities.get(&member.name) == Some(&member.identity)
                    && !active.contains(&member.name)
                {
                    active.push(member.name.clone());
                }
            }
        }
        let mut value =
            profile::smart_group_value(&group.name, group.strategy.as_str(), &active, None)?;
        value[ORIGIN_KEY] = true.into();
        list.push(value);
    }
    add_memberships(&mut yaml, groups)?;
    for item in groups_mut(&mut yaml)? {
        let custom = groups
            .iter()
            .any(|group| item["name"].as_str() == Some(&group.name));
        if custom && item["proxies"].as_sequence().is_some_and(Vec::is_empty) {
            item["proxies"] = Value::Sequence(vec!["REJECT".into()]);
        }
    }
    render(&yaml)
}

pub(super) fn finish(raw: &str, profile_id: &str, store: &Store) -> Result<String, String> {
    if store.revision == 0 {
        return Ok(raw.into());
    }
    let mut yaml = yaml(raw)?;
    let groups = store.groups(profile_id);
    if !groups.is_empty() {
        // The runtime composer regenerates PROXY after projecting the base outlets.
        add_memberships(&mut yaml, groups)?;
        check_cycles(&yaml)?;
    }
    let empty = BTreeMap::new();
    let selections = store
        .profiles
        .get(profile_id)
        .map_or(&empty, |profile| &profile.selections);
    runtime::set_metadata(&mut yaml, selections)?;
    render(&yaml)
}

pub(super) fn project_outlets(
    raw: &str,
    profile_id: &str,
    store: &Store,
) -> Result<String, String> {
    let raw = project(raw, profile_id, store)?;
    let (raw, _) = composer::ensure_bt_pt_and_proxy_group(&raw)?;
    finish(&raw, profile_id, store)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    name: String,
    label: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    node: Option<admission::Node>,
}

fn primary_selector(source: &Value, entries: &[Entry], custom: &[Group]) -> Option<String> {
    let native: Vec<_> = entries
        .iter()
        .filter(|entry| {
            entry.kind == "select"
                && entry.name != "PROXY"
                && !custom.iter().any(|group| group.name == entry.name)
        })
        .map(|entry| entry.name.as_str())
        .collect();
    let match_target = source["rules"]
        .as_sequence()
        .into_iter()
        .flatten()
        .find_map(|rule| {
            let mut fields = rule.as_str()?.split(',').map(str::trim);
            let kind = fields.next()?;
            let target = fields.next()?;
            kind.eq_ignore_ascii_case("MATCH").then_some(target)
        });
    match_target
        .filter(|name| native.contains(name))
        .or_else(|| {
            native.iter().copied().find(|name| {
                matches!(
                    name.trim().to_ascii_uppercase().as_str(),
                    "PROXY" | "PROXIES" | "DEFAULT" | "SELECT" | "MANUAL"
                ) || ["节点选择", "手动选择", "主节点", "主力节点", "核心节点"]
                    .iter()
                    .any(|hint| name.contains(hint))
            })
        })
        .or_else(|| {
            let proxy = source["proxy-groups"]
                .as_sequence()?
                .iter()
                .find(|group| group["name"].as_str() == Some("PROXY"))?;
            proxy["proxies"]
                .as_sequence()?
                .first()?
                .as_str()
                .filter(|name| native.contains(name))
        })
        .or_else(|| {
            entries.iter().any(|entry| entry.kind == "select" && entry.name == "PROXY")
                .then_some("PROXY")
        })
        .or_else(|| match native.as_slice() {
            [only] => Some(*only),
            _ => None,
        })
        .map(str::to_owned)
}

struct Context {
    id: String,
    name: String,
    raw: String,
    nodes: local_nodes::Store,
    base: String,
}

impl Context {
    fn load() -> Result<Self, String> {
        let (id, file) = super::current_source();
        let name = profile::read_profiles_index()
            .into_iter()
            .find(|item| item.id == id)
            .map_or_else(|| "本地默认方案".into(), |item| item.name);
        let raw = fs::read_to_string(file).map_err(|_| "读取当前方案失败")?;
        let nodes = local_nodes::read()?;
        let base = super::prepare_profile_base(&raw, &settings::get_general_settings()?, &nodes)?;
        Ok(Self {
            id,
            name,
            raw,
            nodes,
            base,
        })
    }

    fn catalog(&self, store: &Store) -> Result<Vec<Entry>, String> {
        let projected = project_outlets(&self.base, &self.id, store)?;
        let yaml = yaml(&projected)?;
        let mut entries = ACTIONS
            .iter()
            .map(|(name, label)| Entry {
                name: (*name).into(),
                label: (*label).into(),
                kind: "action",
                node: None,
            })
            .collect::<Vec<_>>();
        for group in yaml["proxy-groups"].as_sequence().into_iter().flatten() {
            let Some(name) = group["name"]
                .as_str()
                .filter(|name| !internal_name(name) && *name != "GLOBAL")
            else {
                continue;
            };
            if group["hidden"].as_bool() == Some(true) {
                continue;
            }
            let kind = match group["type"].as_str() {
                Some("select") => "select",
                Some("url-test") => "url-test",
                _ => "group",
            };
            entries.push(Entry {
                name: name.into(),
                label: name.into(),
                kind,
                node: None,
            });
        }
        for definition in yaml["proxies"].as_sequence().into_iter().flatten() {
            let Some(name) = definition["name"].as_str().filter(|name| {
                name.starts_with(local_nodes::PREFIX)
                    || (!internal_name(name) && !composer::is_info_or_fake_node(name))
            }) else {
                continue;
            };
            let local = self.nodes.nodes.iter().find(|node| node.alias() == name);
            let node = admission::node(definition, local.map_or(name, |node| &node.name));
            let label =
                local.map_or_else(|| name.into(), |node| format!("{} · 自建节点", node.name));
            entries.push(Entry {
                name: name.into(),
                label,
                kind: if node.is_some() { "node" } else { "action" },
                node,
            });
        }
        Ok(entries)
    }

    fn view(&self, store: &Store, test_url: &str) -> Result<Workbench, String> {
        let entries = self.catalog(store)?;
        let custom = store.groups(&self.id);
        let running = process::ACTIVE.load(Ordering::SeqCst);
        let primary_selector = primary_selector(&yaml(&self.raw)?, &entries, custom);
        let identities: BTreeMap<_, _> = entries
            .iter()
            .filter_map(|entry| Some((&entry.name, &entry.node.as_ref()?.identity)))
            .collect();
        let probes = admission::view(&self.id, test_url, &entries);
        let automatic = store
            .profiles
            .get(&self.id)
            .map(|profile| &profile.automatic_members);
        let groups = custom
            .iter()
            .map(|group| GroupRow {
                group: group.clone(),
                check_status: admission::check_status(&self.id, store.test_url(), group, running),
                automatic_members: automatic
                    .and_then(|members| members.get(&group.name))
                    .into_iter()
                    .flatten()
                    .filter(|member| identities.get(&member.name) == Some(&&member.identity))
                    .map(|member| member.name.clone())
                    .collect(),
                missing_members: group
                    .members
                    .iter()
                    .filter(|name| !entries.iter().any(|entry| &entry.name == *name))
                    .cloned()
                    .collect(),
                missing_parents: group
                    .parents
                    .iter()
                    .filter(|name| {
                        !entries
                            .iter()
                            .any(|entry| &entry.name == *name && entry.kind == "select")
                    })
                    .cloned()
                    .collect(),
            })
            .collect();
        Ok(Workbench {
            profile_id: self.id.clone(),
            profile_name: self.name.clone(),
            primary_selector,
            revision: store.revision,
            running,
            groups,
            entries,
            test_url: test_url.to_owned(),
            probes,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupRow {
    #[serde(flatten)]
    group: Group,
    check_status: Option<admission::CheckStatus>,
    automatic_members: Vec<String>,
    missing_members: Vec<String>,
    missing_parents: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Workbench {
    profile_id: String,
    profile_name: String,
    primary_selector: Option<String>,
    revision: u64,
    running: bool,
    groups: Vec<GroupRow>,
    entries: Vec<Entry>,
    test_url: String,
    probes: Vec<admission::ProbeView>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Change {
    Create { group: Group },
    Update { group: Group },
    Delete { name: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveRequest {
    profile_id: String,
    revision: u64,
    change: Change,
    #[serde(default)]
    test_url: Option<String>,
}

fn verify_members(
    group: &Group,
    previous: Option<&Group>,
    entries: &[Entry],
    profile_id: &str,
    test_url: &str,
) -> Result<(), String> {
    validate_group(group)?;
    for name in group
        .members
        .iter()
        .filter(|name| !previous.is_some_and(|g| g.members.contains(name)))
    {
        let entry = entries
            .iter()
            .find(|item| &item.name == name)
            .ok_or("新添加的成员已不可用，请刷新策略组")?;
        if entry.kind == "node" && !admission::verified(profile_id, test_url, entry) {
            return Err(format!("请先通过测速再添加节点「{}」", entry.label));
        }
    }
    if group.parents.iter().any(|name| {
        !previous.is_some_and(|group| group.parents.contains(name))
            && !entries
                .iter()
                .any(|item| &item.name == name && item.kind == "select")
    }) {
        return Err("新添加的上级手动组不可用，请刷新策略组".into());
    }
    Ok(())
}

fn references(
    profile_id: &str,
    name: &str,
    groups: &[Group],
    config: &model::Overrides,
) -> Result<Vec<String>, String> {
    let target = model::Target {
        profile_id: profile_id.into(),
        kind: "group".into(),
        name: name.into(),
    };
    let mut result: Vec<_> = groups
        .iter()
        .filter(|group| {
            group.name != name
                && group
                    .members
                    .iter()
                    .chain(&group.parents)
                    .any(|item| item == name)
        })
        .map(|group| format!("策略组「{}」", group.name))
        .collect();
    result.extend(custom_rules::outlet_references(&target)?);
    result.extend(
        config
            .process_rules
            .iter()
            .filter(|rule| rule.target.as_ref() == Some(&target))
            .map(|rule| format!("进程规则「{}」", rule.label)),
    );
    result.extend(
        config
            .dns_rules
            .iter()
            .filter(|rule| rule.target == target)
            .map(|rule| format!("DNS 规则「{}」", rule.domain)),
    );
    result.extend(
        config
            .bundles
            .iter()
            .filter(|bundle| {
                [&bundle.main_target, &bundle.dns_target]
                    .into_iter()
                    .flatten()
                    .any(|item| item == &target)
            })
            .map(|bundle| format!("业务包「{}」", bundle.name)),
    );
    result.extend(crate::commands::business_bundles::outlet_references(
        &target,
    )?);
    result.sort_unstable();
    result.dedup();
    Ok(result)
}

#[tauri::command]
pub(crate) async fn get_policy_groups(test_url: Option<String>) -> Result<Workbench, String> {
    let _lock = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    let store = read()?;
    let test_url = test_url
        .as_deref()
        .filter(|url| admission::validate_url(url).is_ok())
        .unwrap_or_else(|| store.test_url());
    Context::load()?.view(&store, test_url)
}

#[tauri::command]
pub(crate) async fn save_policy_group(request: SaveRequest) -> Result<Workbench, String> {
    let _lock = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    if crate::shutdown::in_progress() {
        return Err("正在退出，暂不能保存策略组".into());
    }
    let mut store = read()?;
    let context = Context::load()?;
    if request.revision != store.revision || request.profile_id != context.id {
        return Err("当前方案或策略组已变更，请刷新后重试".into());
    }
    let entries = context.catalog(&store)?;
    let config = super::read()?;
    let test_url = request
        .test_url
        .unwrap_or_else(|| store.test_url().to_owned());
    admission::validate_url(&test_url)?;
    store.test_url = Some(test_url.clone());
    let active = process::ACTIVE.load(Ordering::SeqCst);
    let initial = if active && !store.profiles.contains_key(&context.id) {
        runtime::current_choices().await?
    } else {
        BTreeMap::new()
    };
    let profile_groups = store.profiles.entry(context.id.clone()).or_default();
    profile_groups.selections.extend(initial);
    let edited = match request.change {
        Change::Create { group } => {
            if entries
                .iter()
                .any(|entry| entry.name.to_lowercase() == group.name.to_lowercase())
            {
                return Err("当前方案已有同名节点或策略组".into());
            }
            verify_members(&group, None, &entries, &context.id, &test_url)?;
            let name = group.name.clone();
            profile_groups.groups.push(group);
            name
        }
        Change::Update { group } => {
            let current = profile_groups
                .groups
                .iter_mut()
                .find(|item| item.name == group.name)
                .ok_or("自建策略组已不存在")?;
            verify_members(&group, Some(current), &entries, &context.id, &test_url)?;
            if group.strategy != Strategy::Select {
                profile_groups.selections.remove(&group.name);
            }
            let name = group.name.clone();
            *current = group;
            name
        }
        Change::Delete { name } => {
            if !profile_groups.groups.iter().any(|item| item.name == name) {
                return Err("自建策略组已不存在".into());
            }
            let uses = references(&context.id, &name, &profile_groups.groups, &config)?;
            if !uses.is_empty() {
                return Err(format!("请先更换这些引用的出口：{}", uses.join("、")));
            }
            profile_groups.groups.retain(|item| item.name != name);
            profile_groups
                .selections
                .retain(|group, member| group != &name && member != &name);
            name
        }
    };
    admission::update_members_on_save(&context.id, &test_url, profile_groups, &entries, &edited);
    let bytes = store.advance()?;
    let next = context.view(&store, &test_url)?;
    apply_candidate(&context, &config, &store, &bytes).await?;
    admission::groups_saved(&context.id, store.groups(&context.id));
    Ok(next)
}

async fn apply_candidate(
    context: &Context,
    config: &model::Overrides,
    store: &Store,
    bytes: &[u8],
) -> Result<(), String> {
    let prepared = super::prepare_with_policy_groups(
        &context.raw,
        config,
        &context.id,
        &context.nodes,
        store,
    )?;
    profile::validate_config(&prepared)?;
    let runtime_path = storage::data_dir().join("core_data/config.yaml");
    let old_runtime = if process::ACTIVE.load(Ordering::SeqCst) {
        let old = fs::read_to_string(runtime_path).map_err(|_| "读取原运行配置失败")?;
        super::apply_runtime(&prepared).await?;
        Some(old)
    } else {
        None
    };
    if let Err(error) = storage::replace_atomic(&path(), bytes) {
        if let Some(old) = old_runtime {
            super::apply_runtime(&old).await.map_err(|restore| {
                format!("保存策略组失败（{error}）。恢复原运行配置也失败（{restore}）")
            })?;
        }
        return Err(format!("保存策略组失败，已恢复原配置（{error}）"));
    }
    super::invalidate_profile_targets(&context.id);
    Ok(())
}
