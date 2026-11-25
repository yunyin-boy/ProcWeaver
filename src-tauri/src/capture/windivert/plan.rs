use super::{context, ownership::Identity, preflight};
use crate::capture::suite_dns::{self, Mode as DnsMode};
use crate::routing_overrides::{bundles, filters, model::{BundleRoute, Overrides}, ownership, tracker::{self, ProcessEntry, TrackingStatus}};
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const MODE: &str = "windivert_v1";
pub const KEY: &str = "procweaver-windivert-v1";
const PUBLIC_IPV6_REJECT_RULES: [&str; 3] = [
    "IP-CIDR6,2000::/3,REJECT,no-resolve",
    "IP-CIDR6,64:ff9b::/96,REJECT,no-resolve",
    "IP-CIDR6,64:ff9b:1::/48,REJECT,no-resolve",
];
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub kind: String,
    pub value: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub owner: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub include_descendants: bool,
}
impl Entry {
    pub fn id(&self) -> Result<String, String> {
        let key = if self.owner.is_empty() { format!("{}:{}", self.kind, self.value.to_ascii_lowercase()) }
            else { serde_json::to_string(&(&self.owner, &self.kind, self.value.to_ascii_lowercase())).map_err(|_| "上下文标识无效")? };
        Ok(preflight::sha256(key.as_bytes())?[..16].into())
    }
    fn matches(&self, path: &str) -> bool {
        match self.kind.as_str() {
            "path" => self.value.eq_ignore_ascii_case(path),
            "name" => self.value.eq_ignore_ascii_case(path.rsplit(['\\', '/']).next().unwrap_or("")),
            "any" => true,
            _ => false,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Instance {
    pub pid: u32,
    pub created_at: u64,
    pub path: String,
    #[serde(default)]
    pub owner: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DnsDomain {
    pub domain: String,
    pub suffix: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub entries: Vec<Entry>,
    pub targets: Vec<Entry>,
    pub instances: Vec<Instance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dns_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dns_domains: Vec<DnsDomain>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dns_all: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owned_dns: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sandbox_dns: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub(crate) dns_modes: BTreeMap<String, DnsMode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) native_dns_servers: Vec<std::net::IpAddr>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub block_ipv6_owners: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mixed_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub managed_endpoints: Vec<std::net::SocketAddr>,
}
impl Plan {
    pub fn validate(&self) -> Result<(), String> {
        if self.entries.len() > 64 || self.targets.len() > 512 || self.instances.len() > 1024
            || self.dns_domains.len() > 4096 || self.owned_dns.len() + self.sandbox_dns.len() > 64
            || self.dns_modes.len() > 64 || self.native_dns_servers.len() > 256 || self.block_ipv6_owners.len() > 64 {
            return Err("WinDivert 接管范围超过容量限制".into());
        }
        if self.dns_port == Some(0) {
            return Err("WinDivert DNS 入口端口无效".into());
        }
        for e in self.entries.iter().chain(&self.targets) {
            if !matches!(e.kind.as_str(), "path" | "name" | "any") || e.value.is_empty() || e.value.len() > 32768
                || e.value.chars().any(char::is_control) || !(61000..=64999).contains(&e.port)
                || e.owner.len() > 256 || e.owner.chars().any(char::is_control)
                || (e.kind == "any" && e.value != "*") {
                return Err("WinDivert 进程入口计划无效".into());
            }
        }
        let mut keys = BTreeSet::new();
        let mut ports = BTreeSet::new();
        if self.entries.iter().any(|e| !keys.insert((&e.owner, &e.kind, e.value.to_ascii_lowercase())) || !ports.insert(e.port)) {
            return Err("接管上下文或端口重复".into());
        }
        if self.targets.iter().any(|t| t.kind == "any" || !self.entries.iter().any(|e| e.owner == t.owner && e.port == t.port)) {
            return Err("接管目标缺少对应规则入口".into());
        }
        for (owners, message) in [
            (&self.owned_dns, "WinDivert 进程 DNS 缺少有效的业务包入口"),
            (&self.sandbox_dns, "WinDivert 沙盒 DNS 缺少有效的业务包入口"),
            (&self.block_ipv6_owners, "WinDivert IPv6 限制缺少有效的业务包入口"),
        ] {
            let mut seen = BTreeSet::new();
            if owners.iter().any(|owner| {
                !owner.strip_prefix("bundle:").is_some_and(|id| !id.is_empty())
                    || !seen.insert(owner)
                    || !self.targets.iter().any(|target| target.owner == *owner)
                    || !self.entries.iter().any(|entry| entry.owner == *owner && entry.kind == "any")
            }) {
                return Err(message.into());
            }
        }
        if self.dns_modes.iter().any(|(owner, mode)| {
            !owner.starts_with("bundle:") || !self.targets.iter().any(|target| target.owner == *owner)
                || (self.uses_owned_dns(owner) == (*mode == DnsMode::SystemNative))
        }) {
            return Err("WinDivert 套件 DNS 模式缺少对应入口".into());
        }
        let mut roots = BTreeSet::new();
        if self.targets.iter().any(|t| !roots.insert((&t.kind, t.value.to_ascii_lowercase()))) {
            return Err("同一启动根匹配多个策略，请使用不同根程序或明确路径绑定".into());
        }
        let mut pids = BTreeSet::new();
        for p in &self.instances {
            if p.pid == 0 || p.created_at == 0 || !pids.insert(p.pid) || p.path.len() > 32768
                || p.path.chars().any(char::is_control) || !std::path::Path::new(&p.path).is_absolute()
                || self.context_for(&p.owner, &p.path).is_none() {
                return Err("WinDivert 实例身份或归属上下文无效".into());
            }
        }
        Ok(())
    }
    fn context_for(&self, owner: &str, path: &str) -> Option<&Entry> {
        ["path", "name", "any"].into_iter().find_map(|kind|
            self.entries.iter().find(|e| e.owner == owner && e.kind == kind && e.matches(path)))
    }
    pub fn port_for(&self, path: &str, pid: u32, created_at: u64) -> Option<u16> {
        self.destination_for(path, pid, created_at).and_then(|(_, port)| port)
    }
    pub(crate) fn destination_for(&self, path: &str, pid: u32, created_at: u64) -> Option<(&str, Option<u16>)> {
        let owner = self.owner_for(path, pid, created_at)?;
        Some((owner, self.context_for(owner, path).map(|entry| entry.port)))
    }
    fn owner_for(&self, path: &str, pid: u32, created_at: u64) -> Option<&str> {
        if pid == 0 || created_at == 0 { return None; }
        if let Some(instance) = self.instances.iter().find(|p| p.pid == pid && p.created_at == created_at && p.path.eq_ignore_ascii_case(path)) {
            return Some(&instance.owner);
        }
        // Explicit roots also work before the observer's next snapshot.
        let target = ["path", "name"].into_iter().find_map(|kind| self.targets.iter().find(|e| e.kind == kind && e.matches(path)));
        if let Some(target) = target {
            return Some(&target.owner);
        }
        // 即时血缘穿透：快照轮询存在时间差，动态派生的子进程在此直接比对祖先链条 (必须确认祖先允许继承)
        let identity = format!("{pid}:{created_at}");
        if let Some(p) = tracker::entry(&identity) {
            for (_, ancestor_path) in &p.ancestors {
                if let Some(target) = ["path", "name"].into_iter().find_map(|kind| {
                    self.targets.iter().find(|e| e.include_descendants && e.kind == kind && e.matches(ancestor_path))
                }) {
                    return Some(&target.owner);
                }
            }
        }
        // 提权辅助进程独立运行：helper 内存中无 tracker 线程时，直接回溯操作系统父进程链路
        #[cfg(windows)]
        {
            let (mut current_pid, mut current_birth) = (pid, created_at);
            for _ in 0..6 {
                let Some(ppid) = crate::routing_overrides::native::parent_pid_of(current_pid) else { break; };
                if ppid == 0 || ppid == current_pid { break; }
                let Some(parent_id) = Identity::inspect(ppid) else { break; };
                // A newer process occupying the parent PID cannot be an ancestor.
                if parent_id.created_at > current_birth { break; }
                if let Some(parent_instance) = self.instances.iter().find(|i| i.pid == ppid && i.created_at == parent_id.created_at) {
                    if let Some(target) = self.targets.iter().find(|t| t.owner == parent_instance.owner && t.include_descendants) {
                        return Some(&target.owner);
                    }
                }
                if let Some(target) = ["path", "name"].into_iter().find_map(|kind| {
                    self.targets.iter().find(|e| e.include_descendants && e.kind == kind && e.matches(&parent_id.path))
                }) {
                    return Some(&target.owner);
                }
                (current_pid, current_birth) = (ppid, parent_id.created_at);
            }
        }
        None
    }
    pub fn refresh_instances(&mut self, config: &Overrides, state: &TrackingStatus) -> Result<(), String> {
        self.instances = instances(config, &state.entries);
        self.validate()
    }
    pub fn has_dns(&self) -> bool {
        self.dns_port.is_some() && (self.dns_all || !self.dns_domains.is_empty())
    }
    pub(crate) fn uses_owned_dns(&self, rule_owner: &str) -> bool {
        self.owned_dns.iter().any(|owner| owner == rule_owner) || self.uses_sandbox_dns(rule_owner)
    }
    pub(crate) fn uses_sandbox_dns(&self, rule_owner: &str) -> bool {
        self.sandbox_dns.iter().any(|owner| owner == rule_owner)
    }
    pub(crate) fn dns_mode(&self, owner: &str) -> Option<DnsMode> {
        self.dns_modes.get(owner).copied()
            .or_else(|| self.uses_owned_dns(owner).then_some(DnsMode::SafePure))
    }
    pub(crate) fn blocks_ipv6(&self, rule_owner: &str) -> bool {
        self.block_ipv6_owners.iter().any(|owner| owner == rule_owner)
    }
    pub fn dns_port_for(&self, name: &str) -> Option<u16> {
        let port = self.dns_port?;
        if self.dns_all {
            return Some(port);
        }
        let name = name.trim_end_matches('.');
        self.dns_domains
            .iter()
            .any(|d| {
                name.eq_ignore_ascii_case(&d.domain)
                    || (d.suffix
                        && name.len() > d.domain.len()
                        && name.as_bytes().get(name.len() - d.domain.len() - 1) == Some(&b'.')
                        && name[name.len() - d.domain.len()..].eq_ignore_ascii_case(&d.domain))
            })
            .then_some(port)
    }
}

fn instances(config: &Overrides, entries: &[ProcessEntry]) -> Vec<Instance> {
    let mut result: Vec<_> = entries.iter().filter_map(|p| {
        let rule = ownership::select(config, p)?;
        Some(Instance { pid: p.pid, created_at: p.created_at, path: p.executable_path.clone()?, owner: ownership::key(rule, config) })
    }).collect();
    result.sort_by_key(|p| p.pid);
    result
}
pub fn instance_revision(config: &Overrides, state: &TrackingStatus) -> String {
    serde_json::to_string(&instances(config, &state.entries)).expect("接管实例可序列化")
}

// Predicates divide processes into exact paths, basenames, and an otherwise
// class. Compile those classes before capture; newly spawned executables need
// only an instance-map update. Drop classes identical to their fallback class.
fn compile_policy(yaml: &Value, owner: &str) -> Result<Vec<(Entry, context::CompiledContext)>, String> {
    let mut keys = context::process_keys(yaml)?;
    let mut unique = BTreeSet::new();
    keys.retain(|(k, v)| unique.insert((k.clone(), v.to_ascii_lowercase())));
    let hash = preflight::sha256(serde_yaml::to_string(yaml).map_err(|_| "策略编码失败")?.as_bytes())?;
    let directory = format!(r"C:\__ProcWeaverContext_{}", &hash[..16]);
    let other = format!(r"{directory}\__other_{}.exe", &hash[16..32]);
    if keys.iter().any(|(_, v)| v.eq_ignore_ascii_case(&other) || v.eq_ignore_ascii_case(other.rsplit('\\').next().unwrap())) {
        return Err("进程规则与保留上下文标识冲突".into());
    }
    let compile = |kind: &str, value: &str, path: &str| -> Result<(Entry, context::CompiledContext), String> {
        let entry = Entry { kind: kind.into(), value: value.into(), port: 61000, owner: owner.into(), include_descendants: false };
        // A common temporary ID makes rule equality independent of listener IDs.
        let compiled = context::compile(yaml, &[context::ProcessContext { id: "compare".into(), executable_path: path.into() }])?.remove(0);
        Ok((entry, compiled))
    };
    let generic = compile("any", "*", &other)?;
    let mut result = vec![generic.clone()];
    let mut names = BTreeMap::new();
    for (_, value) in keys.iter().filter(|(kind, _)| kind == "PROCESS-NAME") {
        let path = format!(r"{directory}\{value}");
        if keys.iter().any(|(k, v)| k == "PROCESS-PATH" && v.eq_ignore_ascii_case(&path)) { return Err("进程条件与保留路径冲突".into()); }
        let candidate = compile("name", value, &path)?;
        names.insert(value.to_ascii_lowercase(), candidate.1.clone());
        if candidate.1 != generic.1 { result.push(candidate); }
    }
    for (_, value) in keys.iter().filter(|(kind, _)| kind == "PROCESS-PATH") {
        let candidate = compile("path", value, value)?;
        let name = value.rsplit(['\\', '/']).next().unwrap_or("").to_ascii_lowercase();
        if &candidate.1 != names.get(&name).unwrap_or(&generic.1) { result.push(candidate); }
    }
    Ok(result)
}

// A selectable group may choose any of its configured members after apply.
// Only explicit, entirely proxy-backed groups can carry protected DNS.
fn proxy_backed(
    name: &str,
    nodes: &BTreeSet<&str>,
    groups: &BTreeMap<&str, &Value>,
    verified: &mut BTreeMap<String, bool>,
    depth: usize,
) -> bool {
    if matches!(name, "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS" | "COMPATIBLE" | "GLOBAL" | "RULES" | "DNS") {
        return false;
    }
    if nodes.contains(name) {
        return true;
    }
    let Some(group) = groups.get(name).filter(|_| depth < 16) else { return false };
    if let Some(known) = verified.get(name) {
        return *known;
    }
    // Mark unresolved so a recursive reference cannot authorize the group.
    verified.insert(name.into(), false);
    let valid_kind = matches!(group["type"].as_str(), Some("select" | "url-test" | "fallback" | "load-balance" | "relay"));
    let static_members = ["include-all", "include-all-proxies", "include-all-providers"].iter().all(|key|
        group[*key].is_null() || group[*key].as_bool() == Some(false))
        && (group["use"].is_null() || group["use"].as_sequence().is_some_and(Vec::is_empty))
        && ["filter", "exclude-filter", "exclude-type"].iter().all(|key|
            group[*key].is_null() || group[*key].as_str() == Some(""));
    let result = valid_kind && static_members && group["proxies"].as_sequence().is_some_and(|members|
        !members.is_empty() && members.iter().all(|member| member.as_str().is_some_and(|child|
            proxy_backed(child, nodes, groups, verified, depth + 1))));
    verified.insert(name.into(), result);
    result
}

#[derive(Serialize)]
struct SandboxDnsScope {
    exit: String,
    group: String,
    rules: Vec<String>,
    ipv6: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    preserve_target_ip: bool,
    mode: DnsMode,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    real_ip: bool,
}

fn scoped_dns(yaml: &Value, bundle: &BundleRoute, rules: Vec<String>) -> Option<SandboxDnsScope> {
    if rules.is_empty() { return None; }
    let target = bundle.main_target.as_ref()?;
    let group = bundles::group(&bundle.id, "main");
    let policy = bundle.policy.as_ref();
    let mode = DnsMode::for_policy(policy);
    if target.name == "DIRECT" || yaml[bundles::SELECTIONS][group.as_str()].as_str() != Some(target.name.as_str()) {
        return None;
    }
    let valid = match target.kind.as_str() {
        "node" => yaml["proxies"].as_sequence().into_iter().flatten().any(|node| {
            node["name"].as_str() == Some(target.name.as_str())
                && node["type"].as_str().is_some_and(|kind| !matches!(kind.to_ascii_lowercase().as_str(),
                    "direct" | "reject" | "reject-drop" | "pass" | "compatible" | "dns"))
        }),
        "group" => yaml["proxy-groups"].as_sequence().into_iter().flatten()
            .any(|entry| entry["name"].as_str() == Some(target.name.as_str())),
        _ => false,
    };
    valid.then(|| SandboxDnsScope {
        exit: target.name.clone(),
        group,
        rules,
        ipv6: policy.is_some_and(|policy| !policy.block_ipv6),
        preserve_target_ip: filters::active(bundle),
        mode,
        real_ip: mode == DnsMode::SafePure && bundle.mode == "strict" && !filters::needs_domain(bundle),
    })
}

fn dns_policy_active(bundle: &BundleRoute) -> bool {
    bundle.enabled && bundle.policy.as_ref().is_none_or(|policy| policy.proxy_tcp)
}

/// Managed app and Hook launches use the regular bundle listener.
pub(crate) fn compose_suite_dns(raw: &str, config: &Overrides) -> Result<String, String> {
    if crate::edition::PROCESS || !config.bundles_enabled || !config.process_enabled
        || !config.bundles.iter().any(dns_policy_active) {
        return Ok(raw.into());
    }
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "套件 DNS 配置无效")?;
    let scopes: Vec<_> = config.bundles.iter().filter(|bundle| dns_policy_active(bundle))
        .filter_map(|bundle| scoped_dns(&yaml, bundle, vec![bundles::listener(&bundle.id)])).collect();
    if scopes.is_empty() { return Ok(raw.into()); }
    yaml[bundles::SANDBOX_DNS] = serde_yaml::to_value(scopes).map_err(|_| "套件 DNS 配置无法编码")?;
    serde_yaml::to_string(&yaml).map_err(|_| "套件 DNS 配置无法生成".into())
}

fn bundle_dns_routes(
    yaml: &Value,
    config: &Overrides,
    plan: &mut Plan,
    compiled: &[context::CompiledContext],
) -> Vec<SandboxDnsScope> {
    if crate::edition::PROCESS || !config.bundles_enabled {
        return Vec::new();
    }
    let nodes: BTreeSet<_> = yaml["proxies"].as_sequence().into_iter().flatten().filter(|node|
        node["type"].as_str().is_some_and(|kind| !matches!(kind.to_ascii_lowercase().as_str(),
            "direct" | "reject" | "reject-drop" | "pass" | "compatible" | "dns")))
        .filter_map(|node| node["name"].as_str())
        .collect();
    let groups: BTreeMap<_, _> = yaml["proxy-groups"].as_sequence().into_iter().flatten()
        .filter_map(|group| Some((group["name"].as_str()?, group))).collect();
    let mut verified = BTreeMap::new();
    let mut scopes = Vec::new();
    for bundle in config.bundles.iter().filter(|bundle| dns_policy_active(bundle)) {
        let owner = format!("bundle:{}", bundle.id);
        if !plan.targets.iter().any(|entry| entry.owner == owner) { continue; }
        let mode = DnsMode::for_policy(bundle.policy.as_ref());
        if mode == DnsMode::SystemNative {
            plan.dns_modes.insert(owner.clone(), mode);
        }
        let Some(target) = &bundle.main_target else { continue };
        let group = bundles::group(&bundle.id, "main");
        let known_target = match target.kind.as_str() {
            "node" => nodes.contains(target.name.as_str()),
            "group" => groups.contains_key(target.name.as_str()),
            _ => false,
        };
        if yaml[bundles::SELECTIONS][group.as_str()].as_str() != Some(target.name.as_str()) { continue; }
        if !known_target { continue; }
        let mut rules = Vec::new();
        let listener = bundles::listener(&bundle.id);
        if yaml["sub-rules"].get(listener.as_str()).is_some() {
            rules.push(listener);
        }
        rules.extend(plan.entries.iter().zip(compiled).filter(|(entry, _)| entry.owner == owner)
            .map(|(_, context)| format!("pw-wd-{}", context.id)));
        let Some(scope) = scoped_dns(yaml, bundle, rules) else { continue };
        if mode == DnsMode::SystemNative {
            scopes.push(scope);
            continue;
        }
        if mode == DnsMode::FakeIp || bundle.mode == "sandbox" || filters::active(bundle) {
            scopes.push(scope);
            plan.sandbox_dns.push(owner.clone());
            plan.dns_modes.insert(owner, mode);
            continue;
        }
        if !proxy_backed(&target.name, &nodes, &groups, &mut verified, 0) { continue; }
        let expected = format!("MATCH,{group}");
        let lan = bundles::lan_direct_rules(bundle);
        if plan.entries.iter().zip(compiled).filter(|(entry, _)| entry.owner == owner).all(|(_, context)| {
            let Some((udp, rules)) = context.rules.split_first() else { return false; };
            udp == "NETWORK,UDP,REJECT"
                && rules.get(..lan.len()).is_some_and(|prefix| prefix.iter().map(String::as_str).eq(lan.iter().copied()))
                && matches!(rules.get(lan.len()..), Some([route, reject, ..]) if route == &expected && reject == "MATCH,REJECT")
        }) {
            scopes.push(scope);
            plan.owned_dns.push(owner.clone());
            plan.dns_modes.insert(owner, mode);
        }
    }
    plan.owned_dns.sort_unstable();
    plan.sandbox_dns.sort_unstable();
    if plan.dns_modes.values().any(|mode| *mode == DnsMode::SystemNative) {
        plan.native_dns_servers = suite_dns::system_servers();
    }
    scopes
}

pub fn compose_with_policies(raw: &str, config: &Overrides, policies: &BTreeMap<String, Value>) -> Result<String, String> {
    let yaml: Value = serde_yaml::from_str(raw).map_err(|_| "接管配置无效")?;
    if yaml.get(KEY).is_some() || yaml.get(bundles::SANDBOX_DNS).is_some() { return Err("配置包含保留 WinDivert 字段".into()); }
    let mut entries = Vec::new();
    let mut compiled = Vec::new();
    let mut used = BTreeSet::new();
    for (owner, policy) in policies {
        for (mut entry, mut rules) in compile_policy(policy, owner)? {
            if entries.len() >= 64 { return Err("完整规则需要超过 64 个进程上下文，未启用 WinDivert".into()); }
            let id = entry.id()?;
            let offset = u16::from_str_radix(&id[..4], 16).map_err(|_| "上下文编号无效")? % 4000;
            entry.port = (0..4000).map(|i| 61000 + (offset + i) % 4000).find(|p| used.insert(*p)).ok_or("接管端口不足")?;
            // Rename generated references only; never replace user rule text.
            rules.reidentify(&id);
            entries.push(entry); compiled.push(rules);
        }
    }
    let mut domains_set = BTreeSet::new();
    let mut dns_domains = Vec::new();
    if config.dns_enabled {
        for r in config.dns_rules.iter().filter(|r| r.enabled) {
            let domain = r.domain.trim_end_matches('.').to_ascii_lowercase();
            let suffix = r.domain_kind == "suffix";
            if domains_set.insert((domain.clone(), suffix)) {
                dns_domains.push(DnsDomain { domain, suffix });
            }
        }
    }
    let (bundle_domain, bundle_only) = crate::commands::dns_listener::bundle_scope(&yaml);
    if let Some(domain) = bundle_domain {
        if domains_set.insert((domain.to_owned(), false)) {
            dns_domains.push(DnsDomain { domain: domain.to_owned(), suffix: false });
        }
    }
    if config.bundles_enabled && !bundle_only {
        for b in config.bundles.iter().filter(|b| b.enabled) {
            for d in &b.domains {
                let clean = d.trim().trim_end_matches('.').to_ascii_lowercase();
                if clean == crate::routing_overrides::model::ANTIGRAVITY_CLOUDCODE_DOMAIN && b.is_official_antigravity() {
                    continue;
                }
                let domain = clean.trim_start_matches('*').trim_start_matches('.').to_string();
                if !domain.is_empty() && domains_set.insert((domain.clone(), true)) {
                    dns_domains.push(DnsDomain { domain, suffix: true });
                }
            }
        }
    }
    // 方案 A: WinDivert 采用精准白名单业务分流，绝不可无差别劫持全网未知域名的 DNS，
    // 以免导致普通浏览器与非代理软件被 Fake-IP 污染而产生全网断网。
    let dns_all = crate::commands::dns_adapter::is_windivert_dns_guard_active();
    let dns_port = if (dns_all || !dns_domains.is_empty())
        && yaml["dns"]["enable"].as_bool() == Some(true)
    {
        yaml["dns"]["listen"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .and_then(|s| crate::commands::dns_runtime::parse_listen(s).ok())
            .map(|a| a.port())
    } else {
        None
    };
    let mixed_port = if crate::storage::is_initialized() {
        crate::commands::settings::get_general_settings().map(|s| s.mixed_port).ok()
    } else {
        None
    };
    let managed_endpoints = crate::capture::local_proxy::managed_endpoints_with_port(mixed_port);
    let mut plan = Plan {
        entries,
        targets: vec![],
        instances: vec![],
        dns_port,
        dns_domains,
        dns_all,
        owned_dns: vec![],
        sandbox_dns: vec![],
        dns_modes: BTreeMap::new(),
        native_dns_servers: vec![],
        block_ipv6_owners: vec![],
        mixed_port,
        managed_endpoints,
    };
    if config.process_enabled {
        for rule in config.process_rules.iter().filter(|r| ownership::standalone(r, config)) {
            let owner = ownership::key(rule, config);
            let path = if rule.match_kind == "path" { rule.match_value.clone() } else { format!(r"C:\__ProcWeaverRoot\{}", rule.match_value) };
            let port = plan.context_for(&owner, &path).ok_or("目标缺少所属策略上下文")?.port;
            plan.targets.push(Entry {
                kind: rule.match_kind.clone(),
                value: rule.match_value.clone(),
                port,
                owner,
                include_descendants: rule.include_descendants,
            });
        }
    }
    let sandbox_dns = bundle_dns_routes(&yaml, config, &mut plan, &compiled);
    if !crate::edition::PROCESS && config.bundles_enabled {
        plan.block_ipv6_owners = config.bundles.iter()
            .filter(|bundle| bundle.enabled && matches!(bundle.mode.as_str(), "strict" | "sandbox")
                && bundle.policy.as_ref().is_none_or(|policy| policy.block_ipv6))
            .map(|bundle| format!("bundle:{}", bundle.id))
            .filter(|owner| plan.targets.iter().any(|target| target.owner == *owner))
            .collect();
        plan.block_ipv6_owners.sort_unstable();
    }
    // The original packet exposes only a loopback destination when the app
    // used the managed proxy directly. Reject known IPv6 targets at its inlet.
    for (entry, context) in plan.entries.iter().zip(&mut compiled) {
        if plan.blocks_ipv6(&entry.owner) {
            context.rules.splice(0..0, PUBLIC_IPV6_REJECT_RULES.map(str::to_owned));
        }
    }
    plan.refresh_instances(config, &crate::routing_overrides::tracker::status(config))?;
    let mut yaml = context::attach(&yaml, &compiled, &plan.entries.iter().map(|e| e.port).collect::<Vec<_>>())?;
    if !sandbox_dns.is_empty() {
        yaml[bundles::SANDBOX_DNS] = serde_yaml::to_value(sandbox_dns).map_err(|_| "沙盒 DNS 配置无法编码")?;
    }
    for bundle in config.bundles.iter().filter(|bundle| plan.blocks_ipv6(&format!("bundle:{}", bundle.id))) {
        let name = bundles::listener(&bundle.id);
        let owned_listener = yaml["listeners"].as_sequence().into_iter().flatten().any(|listener|
            listener["name"].as_str() == Some(name.as_str()) && listener["rule"].as_str() == Some(name.as_str())
                && listener["type"].as_str() == Some("mixed") && listener["listen"].as_str() == Some("127.0.0.1")
                && listener["port"].as_u64() == Some(u64::from(bundle.port)));
        if owned_listener {
            let rules = yaml["sub-rules"][name.as_str()].as_sequence_mut().ok_or("WinDivert 业务包入口规则无效")?;
            rules.splice(0..0, PUBLIC_IPV6_REJECT_RULES.map(Value::from));
        }
    }
    if !yaml["sniffer"].is_mapping() {
        yaml["sniffer"] = serde_yaml::from_str("enable: true\nparse-pure-ip: true\noverride-destination: true\nsniff:\n  TLS:\n    ports: [443, 8443]\n  HTTP:\n    ports: [80, 8080]\n    override-destination: true\n").map_err(|_| "嗅探配置无效")?;
    } else if let Some(sniffer) = yaml["sniffer"].as_mapping_mut() {
        sniffer.insert("enable".into(), true.into());
        sniffer.insert("parse-pure-ip".into(), true.into());
        sniffer.insert("override-destination".into(), true.into());
        if !sniffer.contains_key(Value::from("sniff")) {
            sniffer.insert("sniff".into(), serde_yaml::from_str("TLS:\n  ports: [443, 8443]\nHTTP:\n  ports: [80, 8080]\n  override-destination: true\n").map_err(|_| "嗅探配置无效")?);
        }
    }
    yaml[KEY] = serde_yaml::to_value(plan).map_err(|_| "接管计划序列化失败")?;
    serde_yaml::to_string(&yaml).map_err(|_| "接管配置序列化失败".into())
}

#[cfg(test)]
pub fn compose(raw: &str, config: &Overrides) -> Result<String, String> {
    let mut policies = BTreeMap::new();
    for rule in config.process_rules.iter().filter(|r| ownership::standalone(r, config)) {
        let mut selected = config.clone(); selected.process_rules = vec![rule.clone()];
        let raw = crate::routing_overrides::composer::compose_owned(raw, &selected, "default")?;
        policies.insert(ownership::key(rule, config), serde_yaml::from_str(&raw).unwrap());
    }
    compose_with_policies(raw, config, &policies)
}
#[cfg(test)]
mod tests;
#[cfg(test)]
#[path = "plan/instance_tests.rs"]
mod instance_tests;
