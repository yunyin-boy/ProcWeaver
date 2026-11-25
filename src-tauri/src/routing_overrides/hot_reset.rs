use super::{
    bundles,
    filters::Filters,
    model::{BundleRoute, Overrides},
    native, ownership, tracker,
};
use crate::{
    capture::{
        packet,
        tcp_reset::{self, EstablishedTcp},
        windivert::{ownership::Identity, plan},
    },
    commands::{mihomo_api, process, settings},
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    net::IpAddr,
    sync::{atomic::Ordering, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Strategy {
    Prompt,
    Auto,
    Keep,
}

fn strategy(bundle: &BundleRoute) -> Strategy {
    match bundle
        .policy
        .as_ref()
        .map(|policy| policy.stale_connection_strategy.as_str())
    {
        Some("auto_reset" | "auto_close") => Strategy::Auto,
        Some("ignore" | "keep") => Strategy::Keep,
        _ => Strategy::Prompt,
    }
}

fn outlet(bundle: &BundleRoute) -> Option<&str> {
    bundle
        .main_target
        .as_ref()
        .filter(|_| bundle.enabled && bundle.policy.as_ref().is_none_or(|policy| policy.proxy_tcp))
        .map(|target| target.name.as_str())
}

#[derive(PartialEq, Eq, Hash)]
struct CoreTcp {
    id: String,
    inbound: String,
    start: String,
}

impl CoreTcp {
    fn from_row(row: &Value) -> Option<Self> {
        let metadata = &row["metadata"];
        if metadata["network"].as_str() != Some("tcp") {
            return None;
        }
        Some(Self {
            id: row["id"].as_str()?.into(),
            inbound: metadata["inboundName"].as_str()?.into(),
            start: row["start"].as_str()?.into(),
        })
    }
}

struct NativeTcp {
    endpoint: EstablishedTcp,
    owner: Identity,
}

struct Job {
    id: String,
    name: String,
    group: String,
    outlet: String,
    strategy: Strategy,
    core: Vec<CoreTcp>,
    native: Vec<NativeTcp>,
}

pub(super) struct Transition {
    pid: u32,
    revision: u64,
    jobs: Vec<Job>,
    warning: Option<String>,
}

struct Pending {
    transition: Transition,
    expires: Instant,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Prompt {
    ticket: String,
    bundles: Vec<String>,
    connection_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    prompt: Option<Prompt>,
    warning: Option<String>,
}

async fn core_rows() -> Result<Vec<Value>, String> {
    let mut snapshot = mihomo_api::connection_snapshot().await?;
    match std::mem::take(&mut snapshot["connections"]) {
        Value::Array(rows) => Ok(rows),
        Value::Null => Ok(Vec::new()),
        _ => Err("核心连接列表格式无效".into()),
    }
}

fn matches_core(
    row: &Value,
    inlets: &HashSet<String>,
    job: &Job,
    filter: &Filters,
) -> Option<CoreTcp> {
    let connection = CoreTcp::from_row(row)?;
    if !inlets.contains(&connection.inbound)
        || !row["chains"]
            .as_array()?
            .iter()
            .any(|hop| hop.as_str() == Some(&job.group))
    {
        return None;
    }
    let metadata = &row["metadata"];
    let ip = metadata["destinationIP"]
        .as_str()
        .and_then(|ip| ip.parse::<IpAddr>().ok());
    let port = metadata["destinationPort"].as_str()?.parse().ok()?;
    (!ip.is_some_and(packet::local)
        && filter.accepts(port, metadata["host"].as_str(), ip) == Some(true))
    .then_some(connection)
}

pub(super) async fn snapshot(
    old: &Overrides,
    next: &Overrides,
    old_runtime: Option<&str>,
) -> Option<Transition> {
    let (old, next) = (old.effective(), next.effective());
    let runtime: serde_yaml::Value = serde_yaml::from_str(old_runtime?).ok()?;
    let pid = process::PID.load(Ordering::SeqCst);
    if pid == 0 {
        return None;
    }
    let windivert = settings::get_general_settings().ok()?.traffic_mode == plan::MODE;
    let old_plan: Option<plan::Plan> = serde_yaml::from_value(runtime[plan::KEY].clone()).ok();
    let mut changes = Vec::new();
    for bundle in &next.bundles {
        let Some(target) = outlet(bundle) else {
            continue;
        };
        let previous = old.bundles.iter().find(|old| old.id == bundle.id);
        let previous_target = previous.and_then(outlet);
        let strategy = strategy(bundle);
        if strategy == Strategy::Keep || previous_target == Some(target) {
            continue;
        }
        let group = bundles::group(&bundle.id, "main");
        let mut inlets = HashSet::new();
        if previous_target.is_some()
            && runtime[bundles::SELECTIONS][group.as_str()].as_str() == previous_target
        {
            inlets.insert(bundles::listener(&bundle.id));
            if let Some(plan) = &old_plan {
                let owner = format!("bundle:{}", bundle.id);
                inlets.extend(
                    plan.entries
                        .iter()
                        .filter(|entry| entry.owner == owner)
                        .filter_map(|entry| entry.id().ok().map(|id| format!("pw-wd-{id}"))),
                );
            }
        }
        // An unowned, pre-existing socket exposes no domain or sandbox rule result.
        let find_native = windivert
            && previous_target.is_none()
            && bundle.mode == "strict"
            && !matches!(target, "DIRECT" | "REJECT" | "REJECT-DROP");
        if inlets.is_empty() && !find_native {
            continue;
        }
        let filter = Filters::for_bundle(bundle).ok()?;
        changes.push((
            Job {
                id: bundle.id.clone(),
                name: bundle.name.clone(),
                group,
                outlet: target.into(),
                strategy,
                core: Vec::new(),
                native: Vec::new(),
            },
            inlets,
            filter,
            find_native,
        ));
    }
    if changes.is_empty() {
        return None;
    }

    let mut warning = None;
    if changes.iter().any(|(_, inlets, _, _)| !inlets.is_empty()) {
        match core_rows().await {
            Ok(rows) => {
                for (job, inlets, filter, _) in &mut changes {
                    let candidates = rows
                        .iter()
                        .filter_map(|row| matches_core(row, inlets, job, filter))
                        .collect();
                    job.core = candidates;
                }
            }
            Err(error) => warning = Some(error),
        }
    }
    if changes.iter().any(|(_, _, _, native)| *native) {
        let observed = native::snapshot().and_then(|processes| {
            Ok((
                tracker::enrich_snapshot(processes),
                tcp_reset::established_ipv4()?,
            ))
        });
        match observed {
            Ok((processes, sockets)) => {
                let eligible: HashMap<_, _> = processes
                    .iter()
                    .filter(|item| ownership::select(&old, item).is_none())
                    .filter_map(|item| {
                        let rule = ownership::select(&next, item)?;
                        let id = bundles::owner(&rule.id, &next.bundles)?.id.as_str();
                        Some((
                            item.pid,
                            (
                                id,
                                Identity {
                                    pid: item.pid,
                                    created_at: item.created_at,
                                    path: item.executable_path.clone()?,
                                },
                            ),
                        ))
                    })
                    .collect();
                for endpoint in sockets {
                    let Some((id, owner)) = eligible.get(&endpoint.pid) else {
                        continue;
                    };
                    let ip = IpAddr::V4(*endpoint.remote.ip());
                    if packet::local(ip)
                        || matches!(endpoint.remote.ip().octets(), [198, 18 | 19, ..])
                    {
                        continue;
                    }
                    if let Some((job, _, _, _)) =
                        changes.iter_mut().find(|(job, _, filter, native)| {
                            *native
                                && job.id == *id
                                && filter.accepts(endpoint.remote.port(), None, Some(ip))
                                    == Some(true)
                        })
                    {
                        job.native.push(NativeTcp {
                            endpoint,
                            owner: owner.clone(),
                        });
                    }
                }
            }
            Err(error) => warning = Some(error),
        }
    }
    Some(Transition {
        pid,
        revision: next.revision,
        jobs: changes.into_iter().map(|(job, ..)| job).collect(),
        warning,
    })
}

fn current_pid() -> u32 {
    process::PID.load(Ordering::SeqCst)
}

fn applied_runtime() -> Result<serde_yaml::Value, String> {
    let file = crate::storage::data_dir().join("core_data/config.yaml");
    let raw = std::fs::read_to_string(file).map_err(|_| "读取当前路由失败")?;
    serde_yaml::from_str(&raw).map_err(|_| "当前路由格式无效".into())
}

fn prune(jobs: &mut Vec<Job>, runtime: &serde_yaml::Value) {
    let plan = crate::capture::current_instance_plan(runtime).ok();
    jobs.retain_mut(|job| {
        if runtime[bundles::SELECTIONS][job.group.as_str()].as_str() != Some(job.outlet.as_str()) {
            return false;
        }
        let owner = format!("bundle:{}", job.id);
        job.native.retain(|conn| {
            plan.as_ref()
                .and_then(|plan| {
                    plan.destination_for(&conn.owner.path, conn.owner.pid, conn.owner.created_at)
                })
                .is_some_and(|(id, port)| id == owner && port.is_some())
        });
        !(job.core.is_empty() && job.native.is_empty())
    });
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetResult {
    refreshed: usize,
    failed: usize,
}

async fn reset(jobs: Vec<Job>) -> Result<ResetResult, String> {
    let mut result = ResetResult::default();
    if jobs.iter().any(|job| !job.core.is_empty()) {
        match core_rows().await {
            Ok(rows) => {
                let live: HashSet<_> = rows.iter().filter_map(CoreTcp::from_row).collect();
                // Bound controller requests when a suite has many connections.
                let ids: Vec<_> = jobs
                    .iter()
                    .flat_map(|job| &job.core)
                    .filter(|old| live.contains(old))
                    .map(|old| &old.id)
                    .collect();
                for chunk in ids.chunks(16) {
                    let mut requests = tokio::task::JoinSet::new();
                    for id in chunk {
                        requests.spawn(mihomo_api::close_connection((*id).clone()));
                    }
                    while let Some(response) = requests.join_next().await {
                        match response {
                            Ok(Ok(true)) => result.refreshed += 1,
                            Ok(Ok(false)) => {}
                            _ => result.failed += 1,
                        }
                    }
                }
            }
            Err(_) => result.failed += jobs.iter().map(|job| job.core.len()).sum::<usize>(),
        }
    }
    for conn in jobs.iter().flat_map(|job| &job.native) {
        match tcp_reset::reset_observed(&conn.endpoint, &conn.owner) {
            Ok(true) => result.refreshed += 1,
            Ok(false) => {}
            Err(_) => result.failed += 1,
        }
    }
    Ok(result)
}

pub(super) async fn applied(transition: Option<Transition>) -> Option<Notice> {
    let mut transition = transition.filter(|transition| transition.pid == current_pid())?;
    let mut warning = transition.warning.take();
    let mut prompt = None;
    match applied_runtime() {
        Ok(runtime) => {
            prune(&mut transition.jobs, &runtime);
            let (automatic, manual): (Vec<_>, Vec<_>) = std::mem::take(&mut transition.jobs)
                .into_iter()
                .partition(|job| job.strategy == Strategy::Auto);
            let result = tokio::time::timeout(Duration::from_secs(5), reset(automatic)).await;
            if !matches!(result, Ok(Ok(ResetResult { failed: 0, .. }))) {
                warning = Some("部分旧连接未能刷新".into());
            }
            if !manual.is_empty() {
                transition.jobs = manual;
                prompt = Some(Prompt {
                    ticket: transition.revision.to_string(),
                    bundles: transition.jobs.iter().map(|job| job.name.clone()).collect(),
                    connection_count: transition
                        .jobs
                        .iter()
                        .map(|job| job.core.len() + job.native.len())
                        .sum(),
                });
                *PENDING.lock().unwrap_or_else(|lock| lock.into_inner()) = Some(Pending {
                    transition,
                    expires: Instant::now() + Duration::from_secs(90),
                });
            }
        }
        Err(error) => warning = Some(error),
    }
    if prompt.is_none() && warning.is_none() {
        return None;
    }
    Some(Notice { prompt, warning })
}

pub(crate) async fn confirm(ticket: String, refresh: bool) -> Result<ResetResult, String> {
    let _lock = process::LIFECYCLE.lock().await;
    let mut pending = {
        let mut lock = PENDING.lock().unwrap_or_else(|lock| lock.into_inner());
        if !lock
            .as_ref()
            .is_some_and(|pending| pending.transition.revision.to_string() == ticket)
        {
            return if refresh {
                Err("这批旧连接的确认已过期".into())
            } else {
                Ok(ResetResult::default())
            };
        }
        lock.take().expect("matching pending confirmation")
    };
    if !refresh {
        return Ok(ResetResult::default());
    }
    if Instant::now() >= pending.expires
        || pending.transition.pid != current_pid()
        || pending.transition.revision != super::read()?.revision
    {
        return Err("这批旧连接的确认已过期".into());
    }
    prune(&mut pending.transition.jobs, &applied_runtime()?);
    tokio::time::timeout(Duration::from_secs(5), reset(pending.transition.jobs))
        .await
        .map_err(|_| "刷新旧连接超时".to_string())?
}
