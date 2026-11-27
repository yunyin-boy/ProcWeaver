use super::model::{self, BundlePolicy, BundleRoute};
use serde_yaml::Value;
use std::net::IpAddr;

#[derive(PartialEq)]
enum TargetMode {
    All,
    Include,
    Exclude,
}

enum Target {
    Domain(String),
    Subdomains(String),
    Network(IpAddr, u8),
}

#[derive(Default)]
pub(crate) struct Filters {
    ports: Vec<(u16, u16)>,
    targets: Option<(TargetMode, Vec<Target>)>,
}

pub(crate) fn active(bundle: &BundleRoute) -> bool {
    cfg!(windows)
        && !crate::edition::PROCESS
        && bundle.policy.as_ref().is_some_and(|policy| {
            policy.port_filter_mode != "all" || policy.target_filter_mode != "all"
        })
}

#[cfg(windows)]
pub(crate) fn needs_domain(bundle: &BundleRoute) -> bool {
    Filters::for_bundle(bundle).is_ok_and(|filters| filters.needs_host())
}

pub(crate) fn validate_bundle(bundle: &BundleRoute) -> Result<(), String> {
    Filters::for_bundle(bundle)
        .map(|_| ())
        .map_err(|error| format!("「{}」{error}", bundle.name))
}

/// Validate edited fields at the draft boundary as well as when applying routes.
pub(crate) fn validate_instance_changes(
    instances: &[serde_json::Value],
    previous: &[serde_json::Value],
) -> Result<(), String> {
    use serde_json::{Map, Value};
    let fields = |instance: &Value| -> Map<String, Value> {
        let policy = instance
            .get("policy")
            .filter(|policy| !policy.is_null())
            .unwrap_or(&instance["definition"]["policy"]);
        [
            "portFilterMode",
            "customPorts",
            "targetFilterMode",
            "targetRules",
        ]
        .into_iter()
        .filter_map(|key| Some((key.to_owned(), policy.get(key)?.clone())))
        .collect()
    };
    for instance in instances {
        let values = fields(instance);
        if values.is_empty()
            || instance["instanceId"].as_str().is_some_and(|id| {
                previous
                    .iter()
                    .any(|old| old["instanceId"].as_str() == Some(id) && fields(old) == values)
            })
        {
            continue;
        }
        let name = instance["definition"]["packageName"]
            .as_str()
            .unwrap_or("业务包");
        let policy: BundlePolicy = serde_json::from_value(Value::Object(values))
            .map_err(|_| format!("「{name}」的端口或目标过滤格式无效"))?;
        Filters::parse(&policy).map_err(|error| format!("「{name}」{error}"))?;
    }
    Ok(())
}

impl Filters {
    pub(crate) fn parse(policy: &BundlePolicy) -> Result<Self, String> {
        let ports = match policy.port_filter_mode.as_str() {
            "all" => Vec::new(),
            "web_only" => vec![(80, 80), (443, 443)],
            "custom" => ports(&policy.custom_ports)?,
            _ => return Err("端口过滤模式无效".into()),
        };
        let mode = match policy.target_filter_mode.as_str() {
            "all" => TargetMode::All,
            "include" => TargetMode::Include,
            "exclude" => TargetMode::Exclude,
            _ => return Err("目标过滤模式无效".into()),
        };
        let targets = if mode == TargetMode::All {
            None
        } else {
            let values = policy
                .target_rules
                .iter()
                .map(|value| target(value))
                .collect::<Result<Vec<_>, _>>()?;
            if values.is_empty() {
                return Err("请至少填写一个目标域名、IP 或 CIDR".into());
            }
            Some((mode, values))
        };
        Ok(Self { ports, targets })
    }

    pub(super) fn for_bundle(bundle: &BundleRoute) -> Result<Self, String> {
        bundle
            .policy
            .as_ref()
            .filter(|_| active(bundle))
            .map(Self::parse)
            .transpose()
            .map(Option::unwrap_or_default)
    }

    pub(super) fn direct_rules(&self) -> Vec<String> {
        let mut rules = Vec::new();
        if !self.ports.is_empty() {
            // Keep Mihomo's per-condition range limit, without expanding ranges to individual ports.
            let groups = self
                .ports
                .chunks(28)
                .map(|group| {
                    let expression = group
                        .iter()
                        .map(|&(first, last)| {
                            if first == last {
                                first.to_string()
                            } else {
                                format!("{first}-{last}")
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("/");
                    format!("DST-PORT,{expression}")
                })
                .collect();
            rules.push(format!("NOT,(({})),DIRECT", either(groups)));
        }
        if let Some((mode, targets)) = &self.targets {
            let conditions = targets
                .iter()
                .map(|target| match target {
                    Target::Domain(name) => format!("DOMAIN,{name}"),
                    Target::Subdomains(suffix) => format!("DOMAIN-WILDCARD,*.{suffix}"),
                    Target::Network(address, length) => format!("IP-CIDR,{address}/{length}"),
                })
                .collect();
            let joined = either(conditions);
            rules.push(if *mode == TargetMode::Include {
                format!("NOT,(({joined})),DIRECT")
            } else {
                format!("{joined},DIRECT")
            });
        }
        rules
    }

    /// No outcome when the snapshot lacks an address needed for classification.
    pub(crate) fn accepts(
        &self,
        port: u16,
        host: Option<&str>,
        ip: Option<IpAddr>,
    ) -> Option<bool> {
        if !self.ports.is_empty()
            && !self
                .ports
                .iter()
                .any(|&(start, end)| (start..=end).contains(&port))
        {
            return Some(false);
        }
        self.accepts_target(host, ip)
    }

    pub(crate) fn accepts_connection(&self, port: u16, host: Option<&str>, ip: Option<IpAddr>) -> bool {
        self.accepts(port, host, ip).unwrap_or_else(|| {
            self.targets.as_ref().is_none_or(|(mode, _)| *mode != TargetMode::Include)
        })
    }

    pub(crate) fn accepts_dns(&self, host: &str) -> bool {
        // The query precedes the connection: its resolver port and the eventual
        // address cannot determine which exit should resolve this name.
        self.accepts_target(Some(host), None).unwrap_or(true)
    }

    pub(crate) fn needs_host(&self) -> bool {
        self.targets.as_ref().is_some_and(|(_, targets)| {
            targets.iter().any(|target| !matches!(target, Target::Network(..)))
        })
    }

    fn accepts_target(&self, host: Option<&str>, ip: Option<IpAddr>) -> Option<bool> {
        let Some((mode, targets)) = &self.targets else {
            return Some(true);
        };
        let host = host.map(|host| host.trim_end_matches('.').to_ascii_lowercase());
        let mut unknown = false;
        for target in targets {
            if host.is_none() && matches!(target, Target::Domain(_) | Target::Subdomains(_)) {
                unknown = true;
                continue;
            }
            let host = host.as_deref().unwrap_or_default();
            let matched = match target {
                Target::Domain(name) => host == name,
                Target::Subdomains(suffix) => host
                    .strip_suffix(suffix)
                    .is_some_and(|prefix| prefix.ends_with('.') && prefix.len() > 1),
                Target::Network(network, length) => {
                    if let Some(ip) = ip {
                        in_network(ip, *network, *length)
                    } else {
                        unknown = true;
                        false
                    }
                }
            };
            if matched {
                return Some(*mode == TargetMode::Include);
            }
        }
        if unknown {
            None
        } else {
            Some(*mode == TargetMode::Exclude)
        }
    }
}

pub(super) fn append(rules: &mut Vec<Value>, bundle: &BundleRoute) -> Result<(), String> {
    rules.extend(
        Filters::for_bundle(bundle)?
            .direct_rules()
            .into_iter()
            .map(Value::from),
    );
    Ok(())
}

fn either(mut conditions: Vec<String>) -> String {
    if conditions.len() == 1 {
        return conditions.pop().expect("one condition");
    }
    format!("OR,(({}))", conditions.join("),("))
}

fn ports(raw: &str) -> Result<Vec<(u16, u16)>, String> {
    let compact = raw.replace(" -", "-").replace("- ", "-");
    let parse = |port: &str| {
        port.parse::<u16>()
            .ok()
            .filter(|value| *value != 0)
            .ok_or_else(|| format!("端口无效：{port}，请输入 1–65535"))
    };
    let mut ranges = Vec::new();
    for value in compact
        .split(|c: char| c.is_ascii_whitespace() || c == ',' || c == ';')
        .filter(|value| !value.is_empty())
    {
        let (first, last) = value.split_once('-').unwrap_or((value, value));
        let (first, last) = (parse(first)?, parse(last)?);
        if first > last {
            return Err(format!("端口区间起点大于终点：{value}"));
        }
        ranges.push((first, last));
    }
    if ranges.is_empty() {
        return Err("请填写自定义端口或端口区间".into());
    }
    ranges.sort_unstable();
    let mut merged: Vec<(u16, u16)> = Vec::new();
    for (first, last) in ranges {
        if let Some(previous) = merged
            .last_mut()
            .filter(|previous| first <= previous.1.saturating_add(1))
        {
            previous.1 = previous.1.max(last);
        } else {
            merged.push((first, last));
        }
    }
    Ok(merged)
}

fn target(raw: &str) -> Result<Target, String> {
    let text = raw.trim().trim_end_matches('.');
    let invalid = || format!("无效的过滤目标：{raw}，请输入域名、*.域名、IP 或 CIDR");
    if let Some((address, length)) = text.split_once('/') {
        let address = address.parse::<IpAddr>().map_err(|_| invalid())?;
        let max = if address.is_ipv4() { 32 } else { 128 };
        let length = length
            .parse::<u8>()
            .ok()
            .filter(|length| *length <= max)
            .ok_or_else(invalid)?;
        return Ok(Target::Network(address, length));
    }
    if let Ok(address) = text.parse::<IpAddr>() {
        return Ok(Target::Network(
            address,
            if address.is_ipv4() { 32 } else { 128 },
        ));
    }
    if let Some(suffix) = text.strip_prefix("*.").or_else(|| text.strip_prefix('.')) {
        if model::domain(suffix) {
            return Ok(Target::Subdomains(suffix.to_ascii_lowercase()));
        }
    } else if model::domain(text) {
        return Ok(Target::Domain(text.to_ascii_lowercase()));
    }
    Err(invalid())
}

fn in_network(ip: IpAddr, network: IpAddr, length: u8) -> bool {
    match (ip, network) {
        (IpAddr::V4(ip), IpAddr::V4(network)) => {
            length == 0 || u32::from(ip) >> (32 - length) == u32::from(network) >> (32 - length)
        }
        (IpAddr::V6(ip), IpAddr::V6(network)) => {
            length == 0 || u128::from(ip) >> (128 - length) == u128::from(network) >> (128 - length)
        }
        _ => false,
    }
}
