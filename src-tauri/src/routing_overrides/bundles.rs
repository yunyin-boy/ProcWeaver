use super::{model::*, composer};
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::collections::{BTreeMap, BTreeSet, HashSet};

pub const SELECTIONS: &str = "procweaver-bundle-selections";
pub(crate) const SANDBOX_DNS: &str = "procweaver-sandbox-dns";
const RULE_SELECTORS: &str = "procweaver-sandbox-rule-selectors";

pub(crate) const LAN_DIRECT_RULES: &[&str] = &[
    "DOMAIN,localhost,DIRECT",
    "DOMAIN-SUFFIX,localhost,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR6,::1/128,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR6,fc00::/7,DIRECT,no-resolve",
    "IP-CIDR6,fe80::/10,DIRECT,no-resolve",
];

pub(crate) fn lan_direct_rules(bundle: &BundleRoute) -> &'static [&'static str] {
    if bundle.policy.as_ref().is_none_or(|policy| policy.bypass_lan) { LAN_DIRECT_RULES } else { &[] }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct RuleSelector {
    source: String,
    outlet: String,
}

pub(crate) type RuleSelectors = BTreeMap<String, RuleSelector>;

pub fn group(id: &str, slot: &str) -> String { format!("PW-{}-{slot}", id.as_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>()) }
pub fn listener(id: &str) -> String { group(id, "entry") }
pub fn owner<'a>(id: &str, bundles: &'a [BundleRoute]) -> Option<&'a BundleRoute> {
    let id = id.strip_prefix("derived:").unwrap_or(id);
    bundles.iter().filter(|b| id.starts_with(&format!("bundle-{}-", b.id))).max_by_key(|b| b.id.len())
}

pub(crate) fn dns_owner<'a>(id: &str, bundles: &'a [BundleRoute]) -> Option<&'a BundleRoute> {
    bundles.iter().filter(|b| id.starts_with(&format!("bundle-dns-{}-", b.id))).max_by_key(|b| b.id.len())
}

// 端口归属于包 ID；排序、换节点和暂时停用都不重新编号。
pub fn assign_ports(config: &mut Overrides, old: &Overrides) -> Result<(), String> {
    let mut occupied: HashSet<u16> = old.bundles.iter().map(|b| b.port).filter(|p| *p != 0).collect();
    let mut next = old.next_bundle_port.max(34000).max(occupied.iter().max().map(|p| p.saturating_add(1)).unwrap_or(34000));
    for bundle in &mut config.bundles {
        if let Some(previous) = old.bundles.iter().find(|b| b.id == bundle.id && b.port != 0) { bundle.port = previous.port; }
        else {
            bundle.port = (next..60000).find(|p| !occupied.contains(p) && std::net::TcpListener::bind(("127.0.0.1", *p)).is_ok()
                && std::net::UdpSocket::bind(("127.0.0.1", *p)).is_ok()).ok_or("没有可用的业务包入口编号")?;
            occupied.insert(bundle.port);
            next = bundle.port + 1;
        }
    }
    config.next_bundle_port = next;
    Ok(())
}

pub fn materialize(raw: &str, config: &Overrides, profile_id: &str) -> Result<(String, Overrides), String> {
    let available = composer::targets(raw, profile_id)?;
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    if yaml.get(SELECTIONS).is_some() || yaml.get(RULE_SELECTORS).is_some() || yaml.get(SANDBOX_DNS).is_some() {
        return Err("订阅包含业务包保留字段".into());
    }
    let mut mapped = config.clone();
    let mut selections = BTreeMap::<String, String>::new();
    let groups = yaml.as_mapping_mut().ok_or("配置须为对象")?.entry(Value::from("proxy-groups"))
        .or_insert(Value::Sequence(vec![])).as_sequence_mut().ok_or("proxy-groups 须为数组")?;
    for bundle in &config.bundles {
        for (slot, target) in [("main", &bundle.main_target), ("dns", &bundle.dns_target)] {
            if slot == "dns" && (bundle.uses_existing_rules() || cfg!(windows) && !crate::edition::PROCESS) { continue; }
            let target = target.as_ref().or(bundle.main_target.as_ref());
            let destination = if bundle.enabled {
                if let Some(target) = target {
                    if target.name == "DIRECT" {
                        "DIRECT"
                    } else if available.contains(target) {
                        target.name.as_str()
                    } else {
                        "REJECT"
                    }
                } else {
                    "REJECT"
                }
            } else { "REJECT" };
            let name = group(&bundle.id, slot);
            if available.iter().any(|t| t.name == name) { return Err("订阅与业务包出口组重名".into()); }
            let mut members: Vec<_> = available.iter().map(|t| t.name.clone()).collect();
            members.sort();
            members.insert(0, "DIRECT".into());
            members.insert(0, "REJECT".into());
            groups.push(serde_yaml::to_value(serde_json::json!({"name": name, "type":"select", "proxies": members, "hidden":true})).unwrap());
            selections.insert(name, destination.into());
        }
    }
    for rule in &mut mapped.process_rules { map_process(rule, &config.bundles, profile_id); }
    for rule in &mut mapped.dns_rules {
        if let Some(bundle) = dns_owner(&rule.id, &config.bundles) {
            rule.target = Target { profile_id: profile_id.into(), kind: "group".into(), name: group(&bundle.id, "dns") };
        }
    }
    yaml[SELECTIONS] = serde_yaml::to_value(selections).unwrap();
    Ok((serde_yaml::to_string(&yaml).map_err(|_| "生成业务包出口组失败")?, mapped))
}
pub fn map_process(rule: &mut ProcessRule, bundles: &[BundleRoute], profile_id: &str) {
    if rule.action == "proxy" {
        if let Some(bundle) = owner(&rule.id, bundles) {
            rule.target = Some(Target {
                profile_id: profile_id.into(), kind: "group".into(), name: group(&bundle.id, "main"),
            });
        }
    }
}
pub fn domain_condition(pattern: &str) -> String {
    match pattern.strip_prefix("*.") { Some(domain)=>format!("DOMAIN-SUFFIX,{domain}"), None=>format!("DOMAIN,{pattern}") }
}

#[cfg(windows)]
pub(super) fn prepare_cloudcode_dns(raw: &str, config: &Overrides, profile_id: &str) -> Result<Option<(String, DnsRule)>, String> {
    let Some(bundle) = config.bundles.iter().find(|b| config.bundles_enabled && b.enabled
        && b.mode == "strict" && b.is_official_antigravity()
        && b.domains.iter().any(|domain| domain == ANTIGRAVITY_CLOUDCODE_DOMAIN)
        && !b.policy.as_ref().is_some_and(|p| matches!(p.dns_mode.as_str(), "system" | "system_native")))
    else { return Ok(None); };
    if config.dns_rules.len() >= 512 || (config.dns_enabled && config.dns_rules.iter()
        .any(|r| r.enabled && composer::matches_domain(ANTIGRAVITY_CLOUDCODE_DOMAIN, r))) {
        return Ok(None);
    }

    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "业务包 DNS 配置无效")?;
    if yaml["dns"]["enable"].as_bool() != Some(true) { return Ok(None); }
    let id = "procweaver-antigravity-cloudcode-dns";
    if config.dns_rules.iter().any(|r| r.id == id) || config.process_rules.iter().any(|r| r.id == id) {
        return Ok(None);
    }
    let rule = DnsRule { id: id.into(), enabled: true, domain_kind: "exact".into(),
        domain: ANTIGRAVITY_CLOUDCODE_DOMAIN.into(), resolver_url: crate::commands::dns::DEFAULT_FALLBACK_DOH.into(),
        target: Target { profile_id: profile_id.into(), kind: "group".into(), name: group(&bundle.id, "main") } };
    if let Err(error) = composer::validate_dns_scope(&yaml, &[&rule]) {
        eprintln!("反重力套件 DNS 策略未启用：{error}");
        return Ok(None);
    }

    // A shared Windows resolver can cache the answer for other processes too.
    // Return real IPs for this host without changing other fake-IP rules.
    if yaml["dns"]["enhanced-mode"].as_str() == Some("fake-ip") {
        let filter = match yaml["dns"]["fake-ip-filter-mode"].as_str().unwrap_or("blacklist") {
            "blacklist" => ANTIGRAVITY_CLOUDCODE_DOMAIN.into(),
            "rule" => format!("DOMAIN,{ANTIGRAVITY_CLOUDCODE_DOMAIN},real-ip"),
            _ => return Ok(None),
        };
        if yaml["dns"]["fake-ip-filter"].is_null() {
            yaml["dns"]["fake-ip-filter"] = Value::Sequence(Vec::new());
        }
        let Some(filters) = yaml["dns"]["fake-ip-filter"].as_sequence_mut() else { return Ok(None); };
        filters.insert(0, filter.into());
    }
    let prepared = serde_yaml::to_string(&yaml).map_err(|_| "生成业务包 DNS 配置失败")?;
    Ok(Some((prepared, rule)))
}

// Business mixed inlets carry the original CONNECT/SOCKS host (DNSNormal).
// In Mihomo 1.19.31 these hosts only enter the sniffer via force-domain;
// parse-pure-ip and force-dns-mapping alone cannot replace such a host.
fn tcp_sniffer_overrides(sniffer: &Value) -> bool {
    let global = sniffer["override-destination"].as_bool().unwrap_or(true);
    let tcp = |name: &str| name.eq_ignore_ascii_case("HTTP") || name.eq_ignore_ascii_case("TLS");
    if let Some(protocols) = sniffer["sniff"].as_mapping().filter(|m| !m.is_empty()) {
        return protocols.iter().any(|(name, config)| name.as_str().is_some_and(tcp)
            && config["override-destination"].as_bool().unwrap_or(global));
    }
    // Legacy protocol list; an absent list loads no sniffers in the bundled core.
    global && sniffer["sniffing"].as_sequence().is_some_and(|names| names.iter().any(|n| n.as_str().is_some_and(tcp)))
}

fn forced_domain_overlaps(forced: &str, business: &str) -> bool {
    let forced = forced.to_ascii_lowercase();
    // Provider/geosite membership is runtime data. Never assume it is disjoint.
    if forced.starts_with("geosite:") || forced.starts_with("rule-set:") { return true; }
    let (base, descendants, minimum_extra) = if let Some(base) = forced.strip_prefix("+.") { (base, true, 0) }
        else if let Some(base) = forced.strip_prefix('.') { (base, true, 1) }
        else { (forced.as_str(), false, 0) };
    let labels: Vec<_> = base.split('.').collect();
    if labels.iter().any(|s| s.is_empty() || (s.contains(['*', '+']) && *s != "*")) { return true; }
    let business = business.to_ascii_lowercase();
    let (business, suffix) = business.strip_prefix("*.").map_or((business.as_str(), false), |base| (base, true));
    let protected: Vec<_> = business.split('.').collect();
    if suffix {
        if !descendants && labels.len() < protected.len() { return false; }
    } else if protected.len() < labels.len() + minimum_extra || (!descendants && protected.len() != labels.len()) {
        return false;
    }
    labels.iter().rev().zip(protected.iter().rev()).all(|(left, right)| *left == "*" || left == right)
}

static LAST_HOSTS_WARNING: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn get_hosts_warning() -> Option<String> {
    LAST_HOSTS_WARNING.lock().ok().and_then(|g| g.clone())
}

pub fn clear_hosts_warning() {
    if let Ok(mut g) = LAST_HOSTS_WARNING.lock() {
        *g = None;
    }
}

pub fn validate_remote_names(raw: &str, config: &Overrides) -> Result<(), String> {
    if !cfg!(windows) || crate::edition::PROCESS || !config.bundles_enabled { return Ok(()); }
    let enabled: Vec<_> = config.bundles.iter().filter(|b| b.enabled).collect();
    if enabled.is_empty() { return Ok(()); }
    let yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    // Hosts and destination overriding run before proxy dialing in Mihomo.
    // Record warnings rather than rejecting public user settings.
    let protected = |name: &str| {
        let name = name.trim_start_matches(['*', '+', '.']).trim_end_matches('.').to_ascii_lowercase();
        if name == "localhost" || name.parse::<std::net::IpAddr>().is_ok() { return false; }
        if name.is_empty() { return false; }
        enabled.iter().any(|b| b.domains.iter().any(|pattern| {
            let root = pattern.strip_prefix("*.").unwrap_or(pattern);
            name == root || name.ends_with(&format!(".{root}")) || root.ends_with(&format!(".{name}"))
        }))
    };
    let mut warning_msg = None;
    if yaml["hosts"].as_mapping().is_some_and(|m| m.keys().any(|key| key.as_str().is_some_and(protected))) {
        eprintln!("[警告] 订阅 hosts 会在业务出口前改写域名，如需确保远端解析请检查订阅 hosts（已正常放行）");
        warning_msg = Some("提示：订阅 Hosts 中包含可能改写业务域名的条目，建议核对".to_string());
    }
    #[cfg(windows)]
    if yaml["dns"]["enable"].as_bool() == Some(true) && yaml["dns"]["use-system-hosts"].as_bool() != Some(false) {
        let path = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("System32/drivers/etc/hosts");
        if let Ok(hosts) = std::fs::read_to_string(path) {
            if hosts.lines().flat_map(|line| line.split('#').next().unwrap_or("").split_whitespace().skip(1)).any(protected) {
                eprintln!("[警告] 系统 hosts 可能改写业务域名；如遇解析异常，可关闭公共 DNS 的使用系统 Hosts（已正常放行）");
                warning_msg = Some("提示：系统 Hosts 中包含业务相关域名，如遇解析异常可在设置中关闭公共 DNS 的「使用系统 Hosts」".to_string());
            }
        }
    }
    let sniffer = &yaml["sniffer"];
    if sniffer["enable"].as_bool() == Some(true) && tcp_sniffer_overrides(sniffer) {
        if let Some(forced) = sniffer["force-domain"].as_sequence() {
            for bundle in &enabled {
                if forced.iter().filter_map(Value::as_str).any(|pattern|
                    bundle.domains.iter().any(|domain| forced_domain_overlaps(pattern, domain))) {
                    eprintln!("[警告] 公共嗅探 force-domain 与业务包「{}」域名范围重叠，可能改写业务原始域名（已正常放行）", bundle.name);
                    if warning_msg.is_none() {
                        warning_msg = Some(format!("提示：公共嗅探 force-domain 与业务包「{}」域名范围重叠", bundle.name));
                    }
                }
            }
        }
    }
    if let Ok(mut g) = LAST_HOSTS_WARNING.lock() {
        *g = warning_msg;
    }
    Ok(())
}
/// 业务包规则合成函数。
/// 遵循【选项 A】：仅按业务进程 + 子进程捕获分流。
/// 严禁在全局公共监听端口（如 10811）的顶层 rules 中注入无进程限定的裸 DOMAIN / DOMAIN-SUFFIX 规则，
/// 从而保证普通浏览器或系统内其他进程在访问 Google、OpenAI 等同域名时，正常遵循公共订阅的分流策略（如 🤖 人工智能、节点选择）。
/// 业务包流量完全通过 WinDivert 驱动级进程树重定向、公共端口的顶层 PROCESS-NAME 进程规则、以及专属监听端口的 sub-rules 实现精准分流。
pub fn compose_bundle_rules(raw: &str, _config: &Overrides) -> Result<String, String> {
    Ok(raw.into())
}

pub(super) fn existing_rules_name(bundle: &BundleRoute) -> String {
    format!("pw-bundle-{}-rules", bundle.id)
}

// Keep the rule expression and its arguments intact while replacing its outbound.
fn existing_rule_parts(rule: &str) -> Option<(&str, &str, &str, &str)> {
    let (kind, rest) = rule.split_once(',')?;
    let start = match kind.trim().to_ascii_uppercase().as_str() {
        "MATCH" => kind.len() + 1,
        "AND" | "OR" | "NOT" | "SUB-RULE" | "DOMAIN-REGEX" | "PROCESS-NAME-REGEX" | "PROCESS-PATH-REGEX" => rule.rfind(',')? + 1,
        _ => kind.len() + 1 + rest.find(',')? + 1,
    };
    let (matcher, tail) = rule.split_at(start);
    let (outbound, options) = tail.split_at(tail.find(',').unwrap_or(tail.len()));
    let outbound = outbound.trim();
    (!outbound.is_empty()).then_some((kind.trim(), matcher, outbound, options))
}

fn non_proxy_outbounds(yaml: &Value) -> HashSet<&str> {
    let mut outbounds = HashSet::from(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "PASS-RULE", "COMPATIBLE"]);
    outbounds.extend(yaml["proxies"].as_sequence().into_iter().flatten()
        .filter(|proxy| proxy["dialer-proxy"].is_null()
            && matches!(proxy["type"].as_str(), Some("direct" | "reject" | "reject-drop" | "pass" | "dns")))
        .filter_map(|proxy| proxy["name"].as_str()));

    let groups: Vec<_> = yaml["proxy-groups"].as_sequence().into_iter().flatten()
        .filter(|group| ["include-all", "include-all-proxies", "include-all-providers"].iter()
            .all(|key| group[*key].as_bool() != Some(true))
            && group["use"].as_sequence().is_none_or(Vec::is_empty))
        .filter_map(|group| Some((group["name"].as_str()?, group["proxies"].as_sequence()?)))
        .collect();
    loop {
        let before = outbounds.len();
        for (name, members) in &groups {
            if !members.is_empty() && members.iter().all(|member| member.as_str().is_some_and(|member| outbounds.contains(member))) {
                outbounds.insert(name);
            }
        }
        if outbounds.len() == before { return outbounds; }
    }
}

fn selectable_non_proxy_members<'a>(yaml: &'a Value, non_proxy: &HashSet<&'a str>) -> BTreeMap<&'a str, BTreeSet<&'a str>> {
    let groups: BTreeMap<_, _> = yaml["proxy-groups"].as_sequence().into_iter().flatten()
        .filter_map(|group| Some((group["name"].as_str()?, group["proxies"].as_sequence()?)))
        .collect();
    let mut choices = BTreeMap::new();
    for &name in groups.keys().filter(|name| !non_proxy.contains(**name)) {
        let mut pending = vec![name];
        let mut visited = HashSet::new();
        let mut members = BTreeSet::new();
        while let Some(member) = pending.pop() {
            if !visited.insert(member) { continue; }
            if non_proxy.contains(member) {
                members.insert(member);
            } else if let Some(children) = groups.get(member) {
                pending.extend(children.iter().filter_map(Value::as_str));
            }
        }
        if !members.is_empty() { choices.insert(name, members); }
    }
    choices
}

pub(super) fn compose_existing_rules(raw: &str, config: &Overrides) -> Result<String, String> {
    let mut bundles = config.bundles.iter().filter(|bundle| bundle.enabled && bundle.uses_existing_rules()).peekable();
    if bundles.peek().is_none() { return Ok(raw.into()); }

    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "沙盒分流配置无效")?;
    let public_rules = yaml["rules"].as_sequence().map_or(&[][..], Vec::as_slice);
    let non_proxy = non_proxy_outbounds(&yaml);
    let choices = selectable_non_proxy_members(&yaml, &non_proxy);
    let mut selectors = RuleSelectors::new();
    let mut new_groups = Vec::new();
    let mut generated = serde_yaml::Mapping::new();
    for bundle in bundles {
        let root = existing_rules_name(bundle);
        let outlet = group(&bundle.id, "main");
        let mut aliases = BTreeMap::<&str, String>::new();
        let mut bundle_selectors = BTreeMap::<&str, String>::new();
        let mut pending = vec![(root.clone(), public_rules)];
        while let Some((name, source)) = pending.pop() {
            let mut rules = Vec::with_capacity(source.len() + 1);
            for value in source {
                let (kind, matcher, target, options) = value.as_str().and_then(existing_rule_parts)
                    .ok_or("现有分流规则格式无效")?;
                if kind.eq_ignore_ascii_case("SUB-RULE") {
                    if !aliases.contains_key(target) {
                        let child = yaml["sub-rules"][target].as_sequence().ok_or("现有分流找不到引用的子规则")?;
                        let alias = format!("{root}-{}", aliases.len());
                        pending.push((alias.clone(), child));
                        aliases.insert(target, alias);
                    }
                    let alias = &aliases[target];
                    rules.push(format!("{matcher}{alias}{options}").into());
                } else if non_proxy.contains(target) {
                    rules.push(value.clone());
                } else if let Some(members) = choices.get(target) {
                    if !bundle_selectors.contains_key(target) {
                        let alias = group(&bundle.id, &format!("rule-{}", bundle_selectors.len()));
                        if ["proxies", "proxy-groups"].iter().any(|key| yaml[*key].as_sequence().into_iter()
                            .flatten().any(|entry| entry["name"].as_str() == Some(alias.as_str()))) {
                            return Err("沙盒分流策略组名称冲突".into());
                        }
                        let mut options = vec!["REJECT", outlet.as_str()];
                        options.extend(members.iter().copied().filter(|member| *member != "REJECT"));
                        new_groups.push(serde_yaml::to_value(serde_json::json!({
                            "name": alias, "type": "select", "proxies": options, "hidden": true,
                        })).map_err(|_| "生成沙盒分流策略组失败")?);
                        selectors.insert(alias.clone(), RuleSelector { source: target.into(), outlet: outlet.clone() });
                        bundle_selectors.insert(target, alias);
                    }
                    rules.push(format!("{matcher}{}{options}", bundle_selectors[target]).into());
                } else {
                    rules.push(format!("{matcher}{outlet}{options}").into());
                }
            }
            if name == root { rules.push("MATCH,DIRECT".into()); }
            if yaml["sub-rules"].get(name.as_str()).is_some() || generated.insert(name.into(), rules.into()).is_some() {
                return Err("沙盒分流子规则名称冲突".into());
            }
        }
    }
    let config = yaml.as_mapping_mut().ok_or("沙盒分流配置须为对象")?;
    config.entry(Value::from("sub-rules")).or_insert(Value::Mapping(Default::default())).as_mapping_mut()
        .ok_or("sub-rules 须为对象")?.extend(generated);
    if !selectors.is_empty() {
        config.entry("proxy-groups".into()).or_insert(Value::Sequence(vec![])).as_sequence_mut()
            .ok_or("proxy-groups 须为数组")?.extend(new_groups);
        config.insert(RULE_SELECTORS.into(), serde_yaml::to_value(selectors).map_err(|_| "生成沙盒分流映射失败")?);
    }
    serde_yaml::to_string(&yaml).map_err(|_| "生成沙盒分流规则失败".into())
}

pub fn add_listeners(yaml: &mut Value, config: &Overrides, _prefix: &Value, fallback: &[Value]) -> Result<(), String> {
    for bundle in &config.bundles {
        if bundle.port == 0 { return Err("业务包入口尚未分配，请重新应用".into()); }
        let name = listener(&bundle.id);
        // Common exclusions must not override an explicitly selected bundle.
        let mut rules = Vec::new();
        if bundle.enabled && config.process_enabled {
            if bundle.policy.as_ref().map_or(true, |p| p.block_udp) { rules.push("NETWORK,UDP,REJECT".into()); }
            rules.extend(lan_direct_rules(bundle).iter().copied().map(Value::from));
            super::filters::append(&mut rules, bundle)?;
            if bundle.uses_existing_rules() {
                let name = existing_rules_name(bundle);
                let existing_rules = yaml["sub-rules"][name.as_str()].as_sequence().ok_or("缺少沙盒分流规则")?;
                rules.extend_from_slice(existing_rules);
            } else if bundle.mode == "sandbox" {
                for pattern in &bundle.domains {
                    let condition=domain_condition(pattern);
                    rules.push(format!("{condition},{}",group(&bundle.id,"main")).into());
                    rules.push(format!("{condition},REJECT").into());
                }
                // 原规则快照在业务包注入前取得，不能再次命中本包或其他包的进程绑定。
                if bundle.fallback == "direct" { rules.push("MATCH,DIRECT".into()); }
                else { rules.extend_from_slice(fallback); }
            } else {
                rules.push(format!("MATCH,{}", group(&bundle.id, "main")).into());
                rules.push("MATCH,REJECT".into());
            }
        } else { rules.extend_from_slice(fallback); }
        let subrules = yaml["sub-rules"].as_mapping_mut().ok_or("sub-rules 须为对象")?;
        if subrules.contains_key(Value::from(name.clone())) { return Err("业务包入口与订阅重名".into()); }
        subrules.insert(name.clone().into(), rules.into());
        let listeners = yaml["listeners"].as_sequence_mut().ok_or("listeners 须为数组")?;
        if listeners.iter().any(|l| crate::capture::contains_port(&l["port"], bundle.port) || crate::capture::contains_port(&l["ports"], bundle.port) || l["name"].as_str() == Some(&name)) {
            return Err("业务包入口端口与已有监听冲突".into());
        }
        listeners.push(serde_yaml::to_value(serde_json::json!({"name":name,"type":"mixed","listen":"127.0.0.1","port":bundle.port,"udp":true,"rule":name})).unwrap());
    }
    Ok(())
}
pub fn structural(raw: &str) -> Result<Value, String> {
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    if let Some(map) = yaml.as_mapping_mut() { map.remove(Value::from(SELECTIONS)); map.remove(Value::from("netbox-capture")); map.remove(Value::from("procweaver-windivert-v1")); }
    Ok(yaml)
}

fn rule_selectors(yaml: &Value) -> Result<RuleSelectors, String> {
    if yaml[RULE_SELECTORS].is_null() { return Ok(RuleSelectors::new()); }
    serde_yaml::from_value(yaml[RULE_SELECTORS].clone()).map_err(|_| "沙盒分流映射无效".into())
}

pub(crate) fn active_rule_selectors() -> Result<RuleSelectors, String> {
    let path = crate::storage::data_dir().join("core_data/config.yaml");
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(RuleSelectors::new()),
        Err(_) => return Err("读取当前沙盒分流映射失败".into()),
    };
    if !raw.contains(RULE_SELECTORS) { return Ok(RuleSelectors::new()); }
    let yaml = serde_yaml::from_str(&raw).map_err(|_| "运行中的沙盒分流配置无效")?;
    rule_selectors(&yaml)
}

fn selected_rule_outlet<'a>(
    selector: &'a RuleSelector,
    proxies: &'a serde_json::Map<String, serde_json::Value>,
    allowed: &[serde_json::Value],
) -> Result<&'a str, String> {
    let mut candidate = selector.source.as_str();
    let mut visited = HashSet::new();
    while visited.insert(candidate) {
        if allowed.iter().any(|member| member.as_str() == Some(candidate)) {
            return Ok(candidate);
        }
        let Some(next) = proxies.get(candidate).and_then(|proxy| proxy["now"].as_str())
            .filter(|next| !next.is_empty()) else { return Ok(&selector.outlet); };
        candidate = next;
    }
    Err("沙盒引用的策略组出口形成循环".into())
}

async fn choose_group(client: &reqwest::Client, url: reqwest::Url, target: &str) -> Result<(), String> {
    client.put(url.clone()).json(&serde_json::json!({"name":target})).send().await.map_err(|_| "切换业务包出口失败")?
        .error_for_status().map_err(|_| "核心拒绝业务包出口")?;
    let confirmed: serde_json::Value = client.get(url).send().await.map_err(|_| "核验业务包出口失败")?
        .error_for_status().map_err(|_| "核心拒绝出口核验")?.json().await.map_err(|_| "出口状态无效")?;
    if confirmed["now"].as_str() != Some(target) { return Err("业务包出口未确认".into()); }
    Ok(())
}

fn group_url(root: &reqwest::Url, name: &str) -> reqwest::Url {
    let mut url = root.clone();
    url.path_segments_mut().unwrap().pop_if_empty().push(name);
    url
}

pub(crate) async fn sync_rule_selectors(client: &reqwest::Client, base: &str, selectors: &RuleSelectors) -> Result<(), String> {
    if selectors.is_empty() { return Ok(()); }
    let proxies: serde_json::Value = client.get(format!("{base}/proxies")).send().await
        .map_err(|_| "读取沙盒引用的策略组失败")?.error_for_status().map_err(|_| "核心拒绝读取沙盒策略组")?
        .json().await.map_err(|_| "沙盒策略组状态无效")?;
    let proxies = proxies["proxies"].as_object().ok_or("核心策略组状态无效")?;
    let root = reqwest::Url::parse(&format!("{base}/proxies/")).map_err(|_| "核心策略组地址无效")?;
    for (name, selector) in selectors {
        let group = proxies.get(name).ok_or("缺少沙盒分流策略组")?;
        let allowed = group["all"].as_array().ok_or("沙盒分流策略组成员无效")?;
        if !proxies.contains_key(&selector.source) { return Err("缺少沙盒引用的原策略组".into()); }
        let target = selected_rule_outlet(selector, proxies, allowed)?;
        if group["now"].as_str() != Some(target) {
            choose_group(client, group_url(&root, name), target).await?;
        }
    }
    Ok(())
}

pub async fn select(raw: &str) -> Result<(), String> {
    let yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    let selections: BTreeMap<String, String> = if yaml[SELECTIONS].is_null() { BTreeMap::new() }
        else { serde_yaml::from_value(yaml[SELECTIONS].clone()).map_err(|_| "业务包出口映射无效")? };
    let selectors = rule_selectors(&yaml)?;
    if selections.is_empty() && selectors.is_empty() { return Ok(()); }
    let port = crate::commands::settings::get_general_settings()?.controller_port;
    let client = crate::commands::mihomo_api::controller_client().timeout(std::time::Duration::from_secs(4)).build().map_err(|_| "核心连接失败")?;
    let base = format!("http://127.0.0.1:{port}");
    let root = reqwest::Url::parse(&format!("{base}/proxies/")).unwrap();
    for (name, target) in selections {
        let url = group_url(&root, &name);
        let current: serde_json::Value = client.get(url.clone()).send().await.map_err(|_| "读取业务包出口失败")?
            .error_for_status().map_err(|_| "业务包出口组不存在")?.json().await.map_err(|_| "出口状态无效")?;
        if current["now"].as_str() == Some(&target) { continue; }
        choose_group(&client, url, &target).await?;
    }
    sync_rule_selectors(&client, &base, &selectors).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sandbox_uses_current_direct_and_reject_choices_in_nested_groups() {
        let selector = RuleSelector { source: "domestic".into(), outlet: "bundle-outlet".into() };
        let mut response = json!({
            "domestic": {"now": "choices"},
            "choices": {"now": "DIRECT"},
            "global-node": {},
        });
        let members = [json!("REJECT"), json!("bundle-outlet"), json!("DIRECT")];
        for (selected, expected) in [
            ("DIRECT", "DIRECT"),
            ("REJECT", "REJECT"),
            ("global-node", "bundle-outlet"),
        ] {
            response["choices"]["now"] = selected.into();
            assert_eq!(selected_rule_outlet(&selector, response.as_object().unwrap(), &members).unwrap(), expected);
        }
    }
}
