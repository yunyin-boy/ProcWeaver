use super::{model::*, composer};
use serde_yaml::Value;
use std::collections::{BTreeMap, HashSet};

pub const SELECTIONS: &str = "procweaver-bundle-selections";
pub fn group(id: &str, slot: &str) -> String { format!("PW-{}-{slot}", id.as_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>()) }
pub fn listener(id: &str) -> String { group(id, "entry") }
pub fn owner<'a>(id: &str, bundles: &'a [BundleRoute]) -> Option<&'a BundleRoute> {
    let id = id.strip_prefix("derived:").unwrap_or(id);
    bundles.iter().filter(|b| id.starts_with(&format!("bundle-{}-", b.id))).max_by_key(|b| b.id.len())
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
    if yaml.get(SELECTIONS).is_some() { return Err("订阅包含业务包保留字段".into()); }
    let mut mapped = config.clone();
    let mut selections = BTreeMap::<String, String>::new();
    let groups = yaml.as_mapping_mut().ok_or("配置须为对象")?.entry(Value::from("proxy-groups"))
        .or_insert(Value::Sequence(vec![])).as_sequence_mut().ok_or("proxy-groups 须为数组")?;
    for bundle in &config.bundles {
        for (slot, target) in [("main", &bundle.main_target), ("dns", &bundle.dns_target)] {
            if slot == "dns" && cfg!(windows) && !crate::edition::PROCESS { continue; }
            let target = target.as_ref().or(bundle.main_target.as_ref());
            let destination = if bundle.enabled {
                let target = target.filter(|t| available.contains(t)).ok_or_else(|| format!("「{}」出口已失效，请重新绑定", bundle.name))?;
                target.name.as_str()
            } else { "REJECT" };
            let name = group(&bundle.id, slot);
            if available.iter().any(|t| t.name == name) { return Err("订阅与业务包出口组重名".into()); }
            let mut members: Vec<_> = available.iter().map(|t| t.name.clone()).collect();
            members.sort(); members.insert(0, "REJECT".into());
            groups.push(serde_yaml::to_value(serde_json::json!({"name": name, "type":"select", "proxies": members, "hidden":true})).unwrap());
            selections.insert(name, destination.into());
        }
    }
    for rule in &mut mapped.process_rules { map_process(rule, &config.bundles, profile_id); }
    for rule in &mut mapped.dns_rules {
        if let Some(bundle) = config.bundles.iter().filter(|b| rule.id.starts_with(&format!("bundle-dns-{}-", b.id))).max_by_key(|b| b.id.len()) {
            rule.target = Target { profile_id: profile_id.into(), kind: "group".into(), name: group(&bundle.id, "dns") };
        }
    }
    yaml[SELECTIONS] = serde_yaml::to_value(selections).unwrap();
    Ok((serde_yaml::to_string(&yaml).map_err(|_| "生成业务包出口组失败")?, mapped))
}
pub fn map_process(rule: &mut ProcessRule, bundles: &[BundleRoute], profile_id: &str) {
    if rule.action == "proxy" {
        if let Some(bundle) = owner(&rule.id, bundles) {
            rule.target = Some(Target { profile_id: profile_id.into(), kind: "group".into(), name: group(&bundle.id, "main") });
        }
    }
}
pub fn domain_condition(pattern: &str) -> String {
    match pattern.strip_prefix("*.") { Some(domain)=>format!("DOMAIN-SUFFIX,{domain}"), None=>format!("DOMAIN,{pattern}") }
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

pub fn validate_remote_names(raw: &str, config: &Overrides) -> Result<(), String> {
    if !cfg!(windows) || crate::edition::PROCESS || !config.bundles_enabled { return Ok(()); }
    let enabled: Vec<_> = config.bundles.iter().filter(|b| b.enabled).collect();
    if enabled.is_empty() { return Ok(()); }
    let yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    // Hosts and destination overriding run before proxy dialing in Mihomo.
    // Reject conflicting combinations rather than rewriting public user settings.
    let protected = |name: &str| {
        let name = name.trim_start_matches(['*', '+', '.']).trim_end_matches('.').to_ascii_lowercase();
        if name == "localhost" || name.parse::<std::net::IpAddr>().is_ok() { return false; }
        if name.is_empty() { return enabled.iter().any(|b| b.mode == "strict" || !b.domains.is_empty()); }
        enabled.iter().any(|b| b.mode == "strict" || b.domains.iter().any(|pattern| {
            let root = pattern.strip_prefix("*.").unwrap_or(pattern);
            name == root || name.ends_with(&format!(".{root}")) || root.ends_with(&format!(".{name}"))
        }))
    };
    if yaml["hosts"].as_mapping().is_some_and(|m| m.keys().any(|key| key.as_str().is_some_and(protected))) {
        return Err("订阅 hosts 会在业务出口前改写域名，无法保证远端解析；请处理冲突 hosts，原配置未修改".into());
    }
    #[cfg(windows)]
    if yaml["dns"]["enable"].as_bool() == Some(true) && yaml["dns"]["use-system-hosts"].as_bool() != Some(false) {
        let path = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("System32/drivers/etc/hosts");
        let hosts = std::fs::read_to_string(path).map_err(|_| "无法核对业务域名与系统 hosts 的冲突")?;
        if hosts.lines().flat_map(|line| line.split('#').next().unwrap_or("").split_whitespace().skip(1)).any(protected) {
            return Err("系统 hosts 可能改写业务域名；请处理冲突项或手动关闭公共 DNS 的使用系统 Hosts，原设置保留".into());
        }
    }
    let sniffer = &yaml["sniffer"];
    if sniffer["enable"].as_bool() == Some(true) && tcp_sniffer_overrides(sniffer) {
        if let Some(forced) = sniffer["force-domain"].as_sequence() {
            for bundle in &enabled {
                if forced.iter().filter_map(Value::as_str).any(|pattern| bundle.mode == "strict"
                    || bundle.domains.iter().any(|domain| forced_domain_overlaps(pattern, domain))) {
                    return Err(format!("公共嗅探 force-domain 与业务包「{}」域名范围重叠，可能改写业务原始域名；请处理该强制嗅探冲突后重试，公共嗅探和 DNS 设置未修改", bundle.name));
                }
            }
        }
    }
    Ok(())
}
pub fn compose_bundle_rules(raw: &str, config: &Overrides) -> Result<String, String> {
    if !config.bundles_enabled { return Ok(raw.into()); }
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    let mut prefix: Vec<Value> = Vec::new();
    for bundle in config.bundles.iter().filter(|b| b.enabled) {
        if bundle.mode == "sandbox" { continue; }
        let dest = group(&bundle.id, "main");
        let block_udp = bundle.policy.as_ref().map_or(true, |p| p.block_udp);
        for pattern in &bundle.domains {
            let cond = domain_condition(pattern);
            if block_udp {
                prefix.push(Value::from(format!("AND,((NETWORK,UDP),({cond})),REJECT")));
            }
            prefix.push(Value::from(format!("{cond},{dest}")));
            if dest != "DIRECT" && dest != "REJECT" {
                prefix.push(Value::from(format!("{cond},REJECT")));
            }
        }
    }
    if !prefix.is_empty() {
        let rules = yaml.as_mapping_mut().ok_or("配置须为对象")?.entry(Value::from("rules"))
            .or_insert(Value::Sequence(vec![])).as_sequence_mut().ok_or("rules 须为数组")?;
        rules.splice(0..0, prefix);
    }
    serde_yaml::to_string(&yaml).map_err(|_| "生成业务包分流规则失败".into())
}
pub fn add_listeners(yaml: &mut Value, config: &Overrides, _prefix: &Value, fallback: &[Value]) -> Result<(), String> {
    for bundle in &config.bundles {
        if bundle.port == 0 { return Err("业务包入口尚未分配，请重新应用".into()); }
        let name = listener(&bundle.id);
        // Common exclusions must not override an explicitly selected bundle.
        let mut rules = Vec::new();
        if bundle.enabled && config.process_enabled {
            if bundle.policy.as_ref().map_or(true, |p| p.block_udp) { rules.push("NETWORK,UDP,REJECT".into()); }
            if bundle.mode == "sandbox" {
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
pub async fn select(raw: &str) -> Result<(), String> {
    let yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    let selections: BTreeMap<String, String> = if yaml[SELECTIONS].is_null() { BTreeMap::new() }
        else { serde_yaml::from_value(yaml[SELECTIONS].clone()).map_err(|_| "业务包出口映射无效")? };
    if selections.is_empty() { return Ok(()); }
    let port = crate::commands::settings::get_general_settings()?.controller_port;
    let client = crate::commands::mihomo_api::controller_client().timeout(std::time::Duration::from_secs(4)).build().map_err(|_| "核心连接失败")?;
    let root = reqwest::Url::parse(&format!("http://127.0.0.1:{port}/proxies/")).unwrap();
    for (name, target) in selections {
        let mut url = root.clone(); url.path_segments_mut().unwrap().pop_if_empty().push(&name);
        let current: serde_json::Value = client.get(url.clone()).send().await.map_err(|_| "读取业务包出口失败")?
            .error_for_status().map_err(|_| "业务包出口组不存在")?.json().await.map_err(|_| "出口状态无效")?;
        if current["now"].as_str() == Some(&target) { continue; }
        client.put(url.clone()).json(&serde_json::json!({"name":target})).send().await.map_err(|_| "切换业务包出口失败")?
            .error_for_status().map_err(|_| "核心拒绝业务包出口")?;
        let confirmed: serde_json::Value = client.get(url).send().await.map_err(|_| "核验业务包出口失败")?
            .error_for_status().map_err(|_| "核心拒绝出口核验")?.json().await.map_err(|_| "出口状态无效")?;
        if confirmed["now"].as_str() != Some(&target) { return Err("业务包出口未确认，已请求恢复原选择".into()); }
    }
    Ok(())
}
