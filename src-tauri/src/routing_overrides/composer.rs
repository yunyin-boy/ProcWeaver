use super::model::*;
use serde_yaml::Value;

pub fn targets(raw: &str, profile_id: &str) -> Result<Vec<Target>, String> {
    let yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    let mut result = Vec::new();
    let mut names = std::collections::HashSet::new();
    for (section, kind) in [("proxies", "node"), ("proxy-groups", "group")] {
        for item in yaml[section].as_sequence().into_iter().flatten() {
            if let Some(name) = item["name"].as_str().filter(|n| safe_atom(n) && !matches!(*n, "DIRECT" | "REJECT" | "GLOBAL" | "RULES")) {
                if !names.insert(name.to_string()) { return Err("节点与策略组存在重名，无法唯一绑定出口".into()); }
                result.push(Target { profile_id: profile_id.into(), kind: kind.into(), name: name.into() });
            }
        }
    }
    Ok(result)
}
pub fn destination<'a>(rule: &'a ProcessRule, available: &[Target]) -> &'a str {
    match rule.action.as_str() {
        "direct" => "DIRECT",
        "proxy" => {
            if let Some(t) = &rule.target {
                if t.name == "DIRECT" {
                    return "DIRECT";
                }
                if available.contains(t) {
                    return t.name.as_str();
                }
            }
            "REJECT"
        }
        _ => "REJECT",
    }
}

/// 顺序：安全例外由外层最后前置；本层进程规则优先于原有规则。
pub fn compose(raw: &str, config: &Overrides, profile_id: &str, derived: &[ProcessRule]) -> Result<String, String> {
    compose_scoped(raw, config, profile_id, derived, false)
}

/// Only called for an already selected runtime owner. Original subscription
/// process predicates still refer to the actual executable during specialization.
pub fn compose_owned(raw: &str, config: &Overrides, profile_id: &str) -> Result<String, String> {
    compose_scoped(raw, config, profile_id, &[], true)
}
fn compose_scoped(raw: &str, config: &Overrides, profile_id: &str, derived: &[ProcessRule], owned: bool) -> Result<String, String> {
    let config = normalize(config.clone())?;
    #[cfg(windows)]
    let windivert_guard = !owned && crate::commands::dns_adapter::is_windivert_dns_guard_active();
    #[cfg(not(windows))]
    let windivert_guard = false;
    if !config.process_enabled && !config.dns_enabled && !windivert_guard { return Ok(raw.into()); }
    let available = targets(raw, profile_id)?;
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    if config.process_enabled {
        // 尊重外部已有进程查找模式设定（如 strict / always）；开启进程分流时默认采用 always 确保代理入站连接可精准匹配发起进程
        if yaml.get("find-process-mode").is_none() || yaml["find-process-mode"].as_str() == Some("off") {
            yaml["find-process-mode"] = "always".into();
        }
        let mut prefix = Vec::new();
        for rule in config.process_rules.iter().filter(|r| r.enabled).chain(derived.iter()) {
            let kind = if rule.match_kind == "path" { "PROCESS-PATH" } else { "PROCESS-NAME" };
            let process = if owned { "OR,((NETWORK,TCP),(NETWORK,UDP))".into() } else { format!("{kind},{}", rule.match_value) };
            let dest = destination(rule, &available);
            if let Some(bundle)=super::bundles::owner(&rule.id,&config.bundles).filter(|b|b.mode=="sandbox") {
                if !bundle.enabled {continue;}
                let block_udp = bundle.policy.as_ref().map_or(true, |p| p.block_udp);
                let scoped_filters = owned && super::filters::active(bundle);
                if scoped_filters {
                    if block_udp { prefix.push("NETWORK,UDP,REJECT".into()); }
                    prefix.extend(super::bundles::lan_direct_rules(bundle).iter().copied().map(Value::from));
                    super::filters::append(&mut prefix, bundle)?;
                }
                if bundle.uses_existing_rules() {
                    if block_udp && !scoped_filters {
                        prefix.push(format!("AND,((NETWORK,UDP),({process})),REJECT").into());
                    }
                    let name = super::bundles::existing_rules_name(bundle);
                    let rules = yaml["sub-rules"][name.as_str()].as_sequence().ok_or("缺少沙盒分流规则")?;
                    if owned {
                        prefix.extend_from_slice(rules);
                        yaml["rules"] = Value::Sequence(vec![]);
                        break;
                    }
                    prefix.push(format!("SUB-RULE,({process}),{name}").into());
                    prefix.push(format!("{process},DIRECT").into());
                    continue;
                }
                for pattern in &bundle.domains {
                    let d_cond = super::bundles::domain_condition(pattern);
                    let condition=format!("AND,(({process}),({d_cond}))");
                    if block_udp {
                        prefix.push(format!("AND,((NETWORK,UDP),({condition})),REJECT").into());
                    }
                    prefix.push(format!("{condition},{dest}").into());
                    if dest!="REJECT" && dest!="DIRECT" {prefix.push(format!("{condition},REJECT").into());}
                }
                // System-dependent fallback is resolved when preparing the plan.
                if bundle.fallback == "direct" { prefix.push(format!("{process},DIRECT").into()); }
                else if !owned && yaml["sub-rules"][super::public_mode::RULES].is_sequence() {
                    prefix.push(format!("SUB-RULE,({process}),{}", super::public_mode::RULES).into());
                }
                continue;
            }
            if rule.rule_mode.as_deref() == Some("inherit") && dest != "DIRECT" && dest != "REJECT" {
                let safe_id = rule.id.replace(|c: char| !c.is_ascii_alphanumeric(), "-");
                let sub_name = format!("proc-sandbox-{safe_id}");
                let subrules = yaml.as_mapping_mut().ok_or("配置须为对象")?.entry(Value::from("sub-rules"))
                    .or_insert(Value::Mapping(Default::default())).as_mapping_mut().ok_or("sub-rules 须为对象")?;
                let sub_rules_list = vec![
                    Value::from("GEOSITE,category-ads-all,REJECT"),
                    Value::from("GEOSITE,cn,DIRECT"),
                    Value::from("GEOIP,cn,DIRECT"),
                    Value::from(format!("MATCH,{dest}")),
                ];
                subrules.insert(Value::from(sub_name.clone()), Value::Sequence(sub_rules_list));
                prefix.push(Value::from(format!("SUB-RULE,({process}),{sub_name}")));
            } else {
                if let Some(bundle) = super::bundles::owner(&rule.id, &config.bundles) {
                    let block_udp = bundle.policy.as_ref().map_or(true, |p| p.block_udp);
                    if block_udp {
                        prefix.push(Value::from(format!("AND,((NETWORK,UDP),({process})),REJECT")));
                    }
                    if owned && bundle.enabled && bundle.mode == "strict" {
                        prefix.extend(super::bundles::lan_direct_rules(bundle).iter().copied().map(Value::from));
                        super::filters::append(&mut prefix, bundle)?;
                    }
                }
                prefix.push(Value::from(format!("{process},{dest}")));
                // 不支持 UDP 的代理可能被核心跳过：同一匹配项随后拒绝，禁止落入原有直连。
                if dest != "DIRECT" && dest != "REJECT" { prefix.push(Value::from(format!("{process},REJECT"))); }
            }
        }
        let rules = yaml.as_mapping_mut().ok_or("配置须为对象")?.entry(Value::from("rules"))
            .or_insert(Value::Sequence(vec![])).as_sequence_mut().ok_or("rules 须为数组")?;
        rules.splice(0..0, prefix);
    }
    let dns_rules: Vec<_> = config.dns_rules.iter().filter(|r| config.dns_enabled && r.enabled).collect();
    if !dns_rules.is_empty() || windivert_guard {
        for r in &dns_rules { if !available.contains(&r.target) { return Err(format!("域名 {} 的 DNS 出口不可用，请重绑定或禁用该规则", r.domain)); } }
        validate_dns_scope(&yaml, &dns_rules)?;
        let was_enabled = yaml["dns"]["enable"].as_bool() == Some(true);
        let dns = yaml.as_mapping_mut().ok_or("配置须为对象")?.entry(Value::from("dns"))
            .or_insert(Value::Mapping(Default::default())).as_mapping_mut().ok_or("dns 须为对象")?;
        dns.insert("enable".into(), true.into());
        dns.entry(Value::from("ipv6")).or_insert(false.into());
        if !was_enabled {
            // 无既有解析器时仅启用内部解析；不新增监听，不改网卡，也不引入 fake-ip。
            dns.insert("enhanced-mode".into(), "redir-host".into());
            dns.insert(Value::from("nameserver"), serde_yaml::to_value(["system"]).unwrap());
            dns.remove(Value::from("fallback"));
        }
        if dns.get(Value::from("proxy-server-nameserver")).is_none_or(|v| v.is_null() || v.as_sequence().is_some_and(|s| s.is_empty())) {
            dns.insert(Value::from("proxy-server-nameserver"), serde_yaml::to_value(["system"]).unwrap());
        }
        let policy = dns.entry(Value::from("nameserver-policy")).or_insert(Value::Mapping(Default::default()))
            .as_mapping_mut().ok_or("nameserver-policy 须为对象")?;
        let original_policy = policy.clone();
        let mut merged_policy = serde_yaml::Mapping::new();
        // 核心会把相邻普通域名合并到同一棵 trie，仅前置域名不能保证覆盖更具体的订阅条目。
        // 使用内联规则集形成独立匹配段：显式 DNS 规则优先，未命中仍按原订阅顺序解析。
        let providers = yaml.as_mapping_mut().ok_or("配置须为对象")?.entry(Value::from("rule-providers"))
            .or_insert(Value::Mapping(Default::default())).as_mapping_mut().ok_or("rule-providers 须为对象")?;
        let mut dns_rules = dns_rules;
        dns_rules.sort_by(|a, b| b.domain.split('.').count().cmp(&a.domain.split('.').count())
            .then_with(|| (a.domain_kind == "suffix").cmp(&(b.domain_kind == "suffix"))));
        let mut index = 0;
        for r in dns_rules {
            let name = loop {
                let name = format!("procweaver-dns-override-{index}"); index += 1;
                if !providers.contains_key(Value::from(name.clone())) { break name; }
            };
            let domain = if r.domain_kind == "suffix" { format!("+.{0}", r.domain) } else { r.domain.clone() };
            providers.insert(name.clone().into(), serde_yaml::to_value(serde_json::json!({
                "type": "inline", "behavior": "domain", "payload": [domain]
            })).map_err(|_| "生成 DNS 域名规则集失败")?);
            merged_policy.insert(format!("rule-set:{name}").into(), format!("{}#{}", r.resolver_url, r.target.name).into());
        }
        merged_policy.extend(original_policy);
        yaml["dns"]["nameserver-policy"] = Value::Mapping(merged_policy);
    }
    serde_yaml::to_string(&yaml).map_err(|_| "合成进程与 DNS 规则失败".into())
}

pub(super) fn validate_dns_scope(yaml: &Value, rules: &[&DnsRule]) -> Result<(), String> {
    // Do not alter the profile's direct resolvers or a local hosts mapping.
    if yaml["dns"]["direct-nameserver"].as_sequence().is_some_and(|v| !v.is_empty())
        && yaml["dns"]["direct-nameserver-follow-policy"].as_bool() != Some(true) {
        return Err("订阅 direct-nameserver 绕过域名策略，请先明确设置 direct-nameserver-follow-policy: true".into());
    }
    if yaml["hosts"].as_mapping().is_some_and(|m| m.keys().any(|k| k.as_str().is_some_and(|s| rules.iter().any(|r| domains_overlap(s, r))))) {
        return Err("指定 DNS 域名与订阅 hosts 冲突，请先移除对应 hosts".into());
    }
    #[cfg(windows)]
    if yaml["dns"]["use-system-hosts"].as_bool() != Some(false) {
        let hosts_path = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("System32/drivers/etc/hosts");
        let hosts = std::fs::read_to_string(hosts_path).map_err(|_| "无法核对系统 hosts，请检查读取权限")?;
        if hosts.lines().flat_map(|line| line.split('#').next().unwrap_or("").split_whitespace().skip(1)).any(|s| rules.iter().any(|r| matches_domain(s, r))) {
            return Err("指定域名命中系统 hosts，无法应用 DNS 策略；请先处理对应 hosts 或显式关闭核心 use-system-hosts".into());
        }
    }
    Ok(())
}

pub fn matches_domain(value: &str, r: &DnsRule) -> bool {
    let value = value.trim_end_matches('.');
    value.eq_ignore_ascii_case(&r.domain) || (r.domain_kind == "suffix" && value.to_ascii_lowercase().ends_with(&format!(".{}", r.domain)))
}
fn domains_overlap(value: &str, r: &DnsRule) -> bool {
    if value.contains([':', ',', '?']) { return true; } // 无法局部判断的规则集或模式须显式解决。
    let suffix = value.starts_with("+.") || value.starts_with("*.") || value.starts_with('.');
    let bare = value.trim_start_matches(['*', '+', '.']).trim_end_matches('.').to_ascii_lowercase();
    if bare.contains('*') { return true; }
    matches_domain(&bare, r) || (suffix && r.domain.ends_with(&format!(".{bare}")))
}

pub(super) fn safety_rules() -> Vec<Value> {
    let mut prefix: Vec<Value> = ["IP-CIDR,127.0.0.0/8,DIRECT,no-resolve", "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve", "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve", "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve", "IP-CIDR6,::1/128,DIRECT,no-resolve", "IP-CIDR6,fc00::/7,DIRECT,no-resolve", "IP-CIDR6,fe80::/10,DIRECT,no-resolve"].into_iter().map(Value::from).collect();
    for name in ["mihomo.exe", "mihomo-v3.exe", "mihomo-compatible.exe"] { prefix.push(format!("PROCESS-NAME,{name},DIRECT").into()); }
    #[cfg(target_os = "macos")]
    for name in ["mihomo-darwin-arm64", "mihomo-darwin-amd64"] { prefix.push(format!("PROCESS-NAME,{name},DIRECT").into()); }
    prefix
}

pub(crate) fn prepend_rules(raw: &str, prefix: &[Value]) -> Result<String, String> {
    if prefix.is_empty() { return Ok(raw.into()); }
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    let rules = yaml.as_mapping_mut().ok_or("配置须为对象")?.entry(Value::from("rules")).or_insert(Value::Sequence(vec![])).as_sequence_mut().ok_or("rules 须为数组")?;
    rules.splice(0..0, prefix.iter().cloned());
    serde_yaml::to_string(&yaml).map_err(|_| "合成前置规则失败".into())
}

pub fn core_bypass(raw: &str) -> Result<String, String> {
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "核心防回环规则无效")?;
    let rules = yaml["rules"].as_sequence_mut().ok_or("缺少运行规则")?;
    let guards = ["mihomo.exe", "mihomo-v3.exe", "mihomo-compatible.exe"].into_iter()
        .map(|name| Value::from(format!("PROCESS-NAME,{name},DIRECT")));
    rules.splice(0..0, guards);
    serde_yaml::to_string(&yaml).map_err(|_| "生成核心防回环规则失败".into())
}

/// 确保本机回环、核心进程与局域网直连规则始终位于 rules 序列最顶层，
/// 避免业务进程规则（如 PROCESS-NAME,Antigravity.exe）把发往 127.0.0.1 或局域网的 IPC 请求劫持至远端节点造成死锁。
pub fn safety_guard(raw: &str) -> Result<String, String> {
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    let rules = yaml.as_mapping_mut().ok_or("配置须为对象")?
        .entry(Value::from("rules")).or_insert(Value::Sequence(vec![]))
        .as_sequence_mut().ok_or("rules 须为数组")?;

    let guards: &[&str] = &[
        "PROCESS-NAME,mihomo.exe,DIRECT",
        "PROCESS-NAME,mihomo-v3.exe,DIRECT",
        "PROCESS-NAME,mihomo-compatible.exe,DIRECT",
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

    rules.retain(|r| !r.as_str().is_some_and(|s| guards.contains(&s)));

    #[allow(unused_mut)]
    let mut prefix: Vec<Value> = guards.iter().map(|&s| Value::from(s)).collect();
    #[cfg(target_os = "macos")]
    for name in ["mihomo-darwin-arm64", "mihomo-darwin-amd64"] {
        prefix.insert(3, format!("PROCESS-NAME,{name},DIRECT").into());
    }

    rules.splice(0..0, prefix);
    serde_yaml::to_string(&yaml).map_err(|_| "生成安全保护规则失败".into())
}

/// 检查节点是否为订阅服务商提供的说明/虚拟假节点（如到期时间、剩余流量提示）
pub(super) fn is_info_or_fake_node(name: &str) -> bool {
    let lower = name.to_lowercase();
    let keywords = [
        "到期", "剩余", "流量", "套餐", "官网", "网址", "重置", "通知", "公告",
        "expire", "traffic", "reset", "website",
    ];
    keywords.iter().any(|&k| name.contains(k) || lower.contains(k))
}

pub(super) fn public_proxy_nodes(yaml: &Value) -> Vec<String> {
    yaml["proxies"].as_sequence().into_iter().flatten()
        .filter_map(|proxy| proxy["name"].as_str().map(str::trim))
        .filter(|name| !name.is_empty() && !matches!(*name, "DIRECT" | "REJECT" | "GLOBAL" | "PROXY")
            && !name.starts_with(super::foreign_targets::PREFIX) && !is_info_or_fake_node(name))
        .map(str::to_owned).collect()
}

/// 生成公共 PROXY 选择组，并补齐国内直连与 BT/PT 规则。
pub(super) fn ensure_bt_pt_and_proxy_group(raw: &str) -> Result<(String, usize), String> {
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    let valid_nodes = public_proxy_nodes(&yaml);
    let map = yaml.as_mapping_mut().ok_or("配置须为对象")?;
    if valid_nodes.is_empty() {
        return Ok((raw.into(), 0));
    }

    // 提取现有所有策略组名称
    let mut existing_group_names = std::collections::HashSet::new();
    if let Some(groups) = map.get(Value::from("proxy-groups")).and_then(|v| v.as_sequence()) {
        for g in groups {
            if let Some(n) = g.get("name").and_then(|n| n.as_str()) {
                existing_group_names.insert(n.to_string());
            }
        }
    }

    // 提取原订阅中 MATCH 规则的原目标及国内直连目标
    let mut original_match_target: Option<String> = None;
    let mut direct_target = "DIRECT".to_string();
    if let Some(rules) = map.get(Value::from("rules")).and_then(|v| v.as_sequence()) {
        for r in rules {
            if let Some(s) = r.as_str() {
                let trimmed = s.trim();
                if trimmed.starts_with("MATCH,") {
                    let target = trimmed.trim_start_matches("MATCH,").trim();
                    if !target.is_empty() {
                        original_match_target = Some(target.to_string());
                    }
                } else if trimmed.starts_with("GEOIP,CN,") {
                    let parts: Vec<&str> = trimmed.split(',').collect();
                    if parts.len() >= 3 {
                        let t = parts[2].trim();
                        if !t.is_empty() && (t == "DIRECT" || existing_group_names.contains(t)) {
                            direct_target = t.to_string();
                        }
                    }
                } else if trimmed.starts_with("GEOSITE,cn,") || trimmed.starts_with("GEOSITE,CN,") {
                    let parts: Vec<&str> = trimmed.split(',').collect();
                    if parts.len() >= 3 {
                        let t = parts[2].trim();
                        if !t.is_empty() && (t == "DIRECT" || existing_group_names.contains(t)) {
                            direct_target = t.to_string();
                        }
                    }
                }
            }
        }
    }

    if direct_target == "DIRECT" {
        for name in &existing_group_names {
            if name.contains("全球直连") || name.contains("直连") {
                direct_target = name.clone();
                break;
            }
        }
    }

    // 2. 当存在真实出站节点时，确保 proxy-groups 中有标准 PROXY select 组，并置于首位
    if !valid_nodes.is_empty() {
        let groups_entry = map.entry(Value::from("proxy-groups"))
            .or_insert(Value::Sequence(Vec::new()));
        
        if let Some(groups) = groups_entry.as_sequence_mut() {
            let mut proxy_group_index = None;
            for (i, g) in groups.iter().enumerate() {
                if let Some(name) = g.get("name").and_then(|n| n.as_str()) {
                    if name == "PROXY" {
                        proxy_group_index = Some(i);
                        break;
                    }
                }
            }

            let mut proxy_group_map = proxy_group_index.and_then(|index| {
                let group = &groups[index];
                (group["type"].as_str() == Some("select")).then(|| group.as_mapping().cloned()).flatten()
            }).unwrap_or_default();
            let mut node_values: Vec<Value> = Vec::new();
            // 2.1 若原订阅原本有主分流组（如 🚀 节点选择），优先作为 PROXY 组首位默认选中项
            if let Some(orig) = &original_match_target {
                if orig != "PROXY" && orig != "DIRECT" && orig != "REJECT" && orig != "GLOBAL"
                    && existing_group_names.contains(orig)
                {
                    node_values.push(Value::String(orig.clone()));
                }
            }
            if let Some(members) = proxy_group_map.get("proxies").and_then(Value::as_sequence) {
                for member in members {
                    if member.as_str().is_some_and(|name| name != "PROXY" && !is_info_or_fake_node(name))
                        && !node_values.contains(member) {
                        node_values.push(member.clone());
                    }
                }
            }
            // 2.2 将原订阅中核心选择策略组（如包含"选择"/"Select"）加入 PROXY
            for g in groups.iter() {
                if let Some(gname) = g.get("name").and_then(|n| n.as_str()) {
                    if g.get(super::policy_groups::ORIGIN_KEY).is_none()
                        && (gname.contains("选择") || gname.contains("Select"))
                        && !node_values.iter().any(|v| v.as_str() == Some(gname))
                        && gname != "PROXY"
                    {
                        node_values.push(Value::String(gname.to_string()));
                    }
                }
            }
            // 2.3 填入真实出站节点
            for n in &valid_nodes {
                if !node_values.iter().any(|v| v.as_str() == Some(n.as_str())) {
                    node_values.push(Value::String(n.clone()));
                }
            }
            // 2.4 补充 DIRECT 直连
            if !node_values.iter().any(|v| v.as_str() == Some("DIRECT")) {
                node_values.push(Value::String("DIRECT".to_string()));
            }

            proxy_group_map.insert("name".into(), "PROXY".into());
            proxy_group_map.insert("type".into(), "select".into());
            proxy_group_map.insert("proxies".into(), Value::Sequence(node_values));

            if let Some(idx) = proxy_group_index {
                groups.remove(idx);
            }
            groups.insert(0, Value::Mapping(proxy_group_map));
        }

        // 规整 MATCH 兜底规则指向 PROXY
        if let Some(rules) = map.get_mut(Value::from("rules")).and_then(|v| v.as_sequence_mut()) {
            let mut has_match = false;
            for r in rules.iter_mut() {
                if let Some(s) = r.as_str() {
                    if s.starts_with("MATCH,") {
                        has_match = true;
                        let target = s.trim_start_matches("MATCH,").trim();
                        if target != "DIRECT" && target != "REJECT" {
                            *r = Value::String("MATCH,PROXY".to_string());
                        }
                    }
                }
            }
            if !has_match {
                rules.push(Value::String("MATCH,PROXY".to_string()));
            }
        }
    }

    // 3. 补齐国内直连规则，解决系统代理纯域名跳过 GEOIP,CN 导致搜狗/微信/国内网站掉入 MATCH 走代理的问题
    if let Some(rules) = map.get_mut(Value::from("rules")).and_then(|v| v.as_sequence_mut()) {
        let mut has_geosite_cn = false;
        let mut has_geoip_cn = false;
        let mut geoip_cn_index = None;
        let mut first_match_index = None;

        for (idx, r) in rules.iter().enumerate() {
            if let Some(s) = r.as_str() {
                let trimmed = s.trim();
                let upper = trimmed.to_ascii_uppercase();
                if upper.starts_with("GEOSITE,CN") {
                    has_geosite_cn = true;
                } else if upper.starts_with("GEOIP,CN") {
                    has_geoip_cn = true;
                    if geoip_cn_index.is_none() {
                        geoip_cn_index = Some(idx);
                    }
                } else if upper.starts_with("MATCH,") {
                    if first_match_index.is_none() {
                        first_match_index = Some(idx);
                    }
                }
            }
        }

        // 去除 GEOIP,CN 尾部的 `,no-resolve`，确保走系统代理的纯域名未命中 GEOSITE 时仍能通过 DNS 获得 IP 命中国内直连
        for r in rules.iter_mut() {
            if let Some(s) = r.as_str() {
                let trimmed = s.trim();
                if (trimmed.starts_with("GEOIP,CN") || trimmed.starts_with("GEOIP,cn")) && trimmed.ends_with(",no-resolve") {
                    let cleaned = trimmed.trim_end_matches(",no-resolve").trim();
                    *r = Value::String(cleaned.to_string());
                }
            }
        }

        // 无条件保底注入国内域名集与国内 IP 直连规则：
        // 插入点优先在现有 GEOIP,CN 之前，其次在 MATCH 兜底规则之前，否则在 rules 序列末尾
        let insert_idx = geoip_cn_index.or(first_match_index).unwrap_or(rules.len());
        let mut injected = Vec::new();
        if !has_geosite_cn {
            injected.push(Value::String(format!("GEOSITE,cn,{}", direct_target)));
        }
        if !has_geoip_cn {
            injected.push(Value::String(format!("GEOIP,CN,{}", direct_target)));
        }

        if !injected.is_empty() {
            rules.splice(insert_idx..insert_idx, injected);
        }
    }

    // 4. 强制在 rules 首部注入 BT/PT 下载客户端与 Tracker 规则（保证全部为 DIRECT）
    let bt_pt_rules = [
        "PROCESS-NAME,qbittorrent.exe,DIRECT",
        "PROCESS-NAME,qbittorrent,DIRECT",
        "PROCESS-NAME,transmission-qt.exe,DIRECT",
        "PROCESS-NAME,transmission-daemon.exe,DIRECT",
        "PROCESS-NAME,transmission.exe,DIRECT",
        "PROCESS-NAME,BitComet.exe,DIRECT",
        "PROCESS-NAME,bitcomet.exe,DIRECT",
        "PROCESS-NAME,Thunder.exe,DIRECT",
        "PROCESS-NAME,xunlei.exe,DIRECT",
        "PROCESS-NAME,ThunderPlatform.exe,DIRECT",
        "PROCESS-NAME,deluge.exe,DIRECT",
        "PROCESS-NAME,utorrent.exe,DIRECT",
        "PROCESS-NAME,uTorrent.exe,DIRECT",
        "PROCESS-NAME,fdm.exe,DIRECT",
        "PROCESS-NAME,motrix.exe,DIRECT",
        "PROCESS-NAME,aria2c.exe,DIRECT",
        "DOMAIN-KEYWORD,torrent,DIRECT",
        "DOMAIN-KEYWORD,tracker,DIRECT",
        "DOMAIN-KEYWORD,announce,DIRECT",
        "DOMAIN-KEYWORD,peer_id=,DIRECT",
        "DOMAIN-KEYWORD,info_hash,DIRECT",
    ];

    let rules_entry = map.entry(Value::from("rules"))
        .or_insert(Value::Sequence(Vec::new()));
    let mut added_prefix = 0;
    if let Some(rules) = rules_entry.as_sequence_mut() {
        let mut to_insert = Vec::new();
        // 先构建现有规则的字符串集合，避免逐项 O(N) 线性搜索，整体降至 O(N+21)。
        let existing: std::collections::HashSet<&str> =
            rules.iter().filter_map(|r| r.as_str()).collect();
        for item in bt_pt_rules {
            if !existing.contains(item) {
                to_insert.push(Value::String(item.to_string()));
            }
        }
        if !to_insert.is_empty() {
            added_prefix = to_insert.len();
            rules.splice(0..0, to_insert);
        }
    }

    // 5. 确保国内与直连 DNS 智能分流（彻底根除国内网站在直连时被海外 DNS 调度到境外 CDN 的严重缺陷）
    if let Some(dns) = map.get_mut(Value::from("dns")).and_then(|v| v.as_mapping_mut()) {
        let is_dns_enabled = dns.get(Value::from("enable")).and_then(|v| v.as_bool()).unwrap_or(true);
        if is_dns_enabled {
            // 5.1 注入 direct-nameserver 与 direct-nameserver-follow-policy
            let direct_ns_key = Value::from("direct-nameserver");
            let has_direct = dns.get(&direct_ns_key)
                .and_then(|v| v.as_sequence())
                .map_or(false, |s| !s.is_empty());
            if !has_direct {
                dns.insert(
                    direct_ns_key,
                    serde_yaml::to_value(["223.5.5.5", "119.29.29.29"]).unwrap(),
                );
            }
            dns.insert(Value::from("direct-nameserver-follow-policy"), Value::Bool(true));

            // 5.2 仅在本地存在 geosite.dat 时注入 nameserver-policy 国内分流策略
            let geosite_exists = crate::storage::data_dir().join("core_data/geosite.dat").exists()
                || crate::storage::data_dir().join("config/geosite.dat").exists();
            if geosite_exists {
                let policy_key = Value::from("nameserver-policy");
                let policy_map = dns.entry(policy_key)
                    .or_insert_with(|| Value::Mapping(Default::default()))
                    .as_mapping_mut();
                if let Some(policy) = policy_map {
                    let cn_key = Value::from("geosite:cn,private");
                    let cn_alt_key = Value::from("geosite:cn");
                    if !policy.contains_key(&cn_key) && !policy.contains_key(&cn_alt_key) {
                        policy.insert(
                            cn_key,
                            serde_yaml::to_value(["223.5.5.5", "119.29.29.29"]).unwrap(),
                        );
                    }
                }
            }
        }
    }

    serde_yaml::to_string(&yaml)
        .map(|content| (content, added_prefix))
        .map_err(|_| "合成BT保护与标准主组失败".into())
}

/// 在 direct_first（白名单直连绝对最高）模式下，
/// 将规则列表中的所有 DIRECT 终点规则提前至所有代理规则之前，保全用户直连免代理特权。
pub fn prioritize_direct_rules(raw: &str) -> Result<String, String> {
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "配置 YAML 无效")?;
    if let Some(rules) = yaml.get_mut("rules").and_then(|v| v.as_sequence_mut()) {
        let mut directs = Vec::new();
        let mut others = Vec::new();
        for r in rules.drain(..) {
            // 直接比较后缀，兼容 AND,(...),DIRECT 等复合规则格式，
            // 避免 split(',') 在嵌套括号规则中 parts[2] 位置错判。
            let is_direct = r.as_str().map_or(false, |s| {
                s.ends_with(",DIRECT") || s.ends_with(",DIRECT,no-resolve")
            });
            if is_direct {
                directs.push(r);
            } else {
                others.push(r);
            }
        }
        rules.extend(directs);
        rules.extend(others);
    }
    serde_yaml::to_string(&yaml).map_err(|_| "重排直连规则失败".into())
}
