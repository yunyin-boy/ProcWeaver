use super::{model::Endpoint, transport::Destination, Engine};
use std::{collections::BTreeMap, net::IpAddr, sync::{Arc, Mutex}};
use tokio::sync::watch;

#[derive(Default)]
pub(super) struct State {
    streams: Mutex<BTreeMap<u64, Stream>>,
    #[cfg(windows)]
    pending: Mutex<Option<Transition>>,
}

struct Stream {
    bundle_id: String,
    destination: Destination,
    address: Option<IpAddr>,
    endpoint: Option<Endpoint>,
    stop: watch::Sender<bool>,
}

struct Registration { runtime: Arc<Engine>, record: u64 }

impl Drop for Registration {
    fn drop(&mut self) {
        self.runtime.hot_reset.streams.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.record);
    }
}

#[derive(Clone)]
pub(super) struct Connection {
    _registration: Arc<Registration>,
    stop: watch::Receiver<bool>,
}

impl Connection {
    pub(super) async fn refreshed(&mut self) {
        let _ = self.stop.wait_for(|value| *value).await;
    }
}

impl Engine {
    pub(super) fn watch_tcp(
        self: &Arc<Self>, record: u64, bundle_id: &str, destination: &Destination,
        address: Option<IpAddr>, endpoint: Option<Endpoint>,
    ) -> Connection {
        let (stop, receiver) = watch::channel(false);
        self.hot_reset.streams.lock().unwrap_or_else(|e| e.into_inner()).insert(record, Stream {
            bundle_id: bundle_id.to_owned(), destination: destination.clone(), address, endpoint, stop,
        });
        Connection { _registration: Arc::new(Registration { runtime: self.clone(), record }), stop: receiver }
    }
}

#[cfg(windows)]
use {
    super::{identity, model::{self, Bundle, Config, Traffic}},
    crate::{
        capture::{packet, tcp_reset::{self, EstablishedTcp}, windivert::ownership::Identity},
        routing_overrides::{filters::Filters, hot_reset::{strategy, Notice, Prompt, Strategy}, native, tracker},
    },
    std::{collections::HashMap, time::{Duration, Instant}},
};

#[cfg(windows)]
pub(super) struct Job {
    name: String,
    strategy: Strategy,
    streams: Vec<u64>,
    sockets: Vec<(EstablishedTcp, Identity)>,
}

#[cfg(windows)]
struct Transition { revision: u64, until: Instant, jobs: Vec<Job> }

#[cfg(windows)]
impl State {
    pub(super) fn snapshot(&self, old: &Config, next: &Config) -> Vec<Job> {
        if !next.enabled { return Vec::new(); }
        let mut changes: HashMap<_, _> = next.bundles.iter().filter_map(|bundle| {
            let policy = bundle.policy.as_ref()?;
            let mode = strategy(Some(policy));
            if !bundle.enabled || mode == Strategy::Keep { return None; }
            let previous = old.bundles.iter().find(|previous| old.enabled && previous.enabled && previous.id == bundle.id);
            let old_endpoint = previous.and_then(|previous| model::endpoint(old, previous).ok());
            let new_endpoint = model::endpoint(next, bundle).ok();
            let changed = old_endpoint != new_endpoint || previous.is_some_and(|previous| {
                (bundle.fallback == "default" || previous.fallback == "default")
                    && old.default_endpoint_id != next.default_endpoint_id
            });
            changed.then(|| (bundle.id.as_str(), Job {
                name: bundle.name.clone(), strategy: mode, streams: Vec::new(), sockets: Vec::new(),
            }))
        }).collect();
        if changes.is_empty() { return Vec::new(); }
        self.capture_streams(next, &mut changes);
        if crate::process_capture::selected() {
            capture_native(next, &mut changes);
        }
        changes.into_values().filter(|job| !job.streams.is_empty() || !job.sockets.is_empty()).collect()
    }

    fn capture_streams(&self, next: &Config, changes: &mut HashMap<&str, Job>) {
        let streams = self.streams.lock().unwrap_or_else(|e| e.into_inner());
        for (record, stream) in streams.iter() {
            let Some(job) = changes.get_mut(stream.bundle_id.as_str()) else { continue; };
            let Some(bundle) = next.bundles.iter().find(|bundle| bundle.id == stream.bundle_id) else { continue; };
            if model::select_exit(next, bundle, &stream.destination.host, stream.destination.port, stream.address, Traffic::Tcp)
                .is_ok_and(|(endpoint, _)| endpoint.is_some() && endpoint != stream.endpoint.as_ref()) {
                job.streams.push(*record);
            }
        }
    }

    pub(super) async fn applied(&self, revision: u64, jobs: Vec<Job>) -> Option<Notice> {
        let (auto, manual): (Vec<_>, Vec<_>) = jobs.into_iter().partition(|job| job.strategy == Strategy::Auto);
        let (_, failed) = self.reset(auto).await;
        let warning = (failed != 0).then(|| "部分旧连接未能刷新".into());
        let prompt = (!manual.is_empty()).then(|| Prompt {
            ticket: revision.to_string(),
            bundles: manual.iter().map(|job| job.name.clone()).collect(),
            connection_count: manual.iter().map(|job| job.streams.len() + job.sockets.len()).sum(),
        });
        *self.pending.lock().unwrap_or_else(|e| e.into_inner()) = prompt.as_ref().map(|_| Transition {
            revision, until: Instant::now() + Duration::from_secs(90), jobs: manual,
        });
        (prompt.is_some() || warning.is_some()).then_some(Notice { prompt, warning })
    }

    pub(super) async fn confirm(&self, revision: u64, ticket: &str, refresh: bool) -> Result<serde_json::Value, String> {
        let transition = {
            let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
            if !pending.as_ref().is_some_and(|pending| pending.revision == revision && revision.to_string() == ticket) {
                return Err("这批旧连接的确认已过期".into());
            }
            pending.take().expect("matching confirmation")
        };
        if refresh && transition.until <= Instant::now() { return Err("这批旧连接的确认已过期".into()); }
        let (refreshed, failed) = if refresh { self.reset(transition.jobs).await } else { (0, 0) };
        Ok(serde_json::json!({"refreshed": refreshed, "failed": failed}))
    }

    async fn reset(&self, jobs: Vec<Job>) -> (usize, usize) {
        let refreshed = {
            let streams = self.streams.lock().unwrap_or_else(|e| e.into_inner());
            jobs.iter().flat_map(|job| &job.streams).filter_map(|record| streams.get(record))
                .filter(|stream| stream.stop.send(true).is_ok()).count()
        };
        if !jobs.iter().any(|job| !job.sockets.is_empty()) { return (refreshed, 0); }
        if crate::process_capture::selected() && !crate::process_capture::active() {
            crate::process_capture::tick().await;
        }
        if !crate::process_capture::active() { return (refreshed, 1); }
        tokio::task::spawn_blocking(move || {
            let mut count = refreshed;
            let mut failed = 0;
            for (socket, owner) in jobs.iter().flat_map(|job| &job.sockets) {
                match tcp_reset::reset_observed(socket, owner) {
                    Ok(true) => count += 1,
                    Ok(false) => {},
                    Err(_) => failed += 1,
                }
            }
            (count, failed)
        }).await.unwrap_or((refreshed, 1))
    }
}

#[cfg(windows)]
fn capture_native(next: &Config, changes: &mut HashMap<&str, Job>) {
    let Ok(sockets) = tcp_reset::established_ipv4() else { return; };
    let Ok(processes) = native::snapshot() else { return; };
    let processes = tracker::enrich_snapshot(processes);
    let owners: HashMap<_, _> = processes.iter().filter_map(|process| {
        let id = identity::owner(&next.bundles, process)?;
        let bundle: &Bundle = next.bundles.iter().find(|bundle| bundle.id == id)?;
        (changes.contains_key(id) && bundle.mode == "strict" && process.created_at != 0)
            .then_some((process.pid, (bundle, process)))
    }).collect();
    for socket in sockets {
        let Some((bundle, process)) = owners.get(&socket.pid) else { continue; };
        let address = IpAddr::V4(*socket.remote.ip());
        if packet::local(address) || matches!(socket.remote.ip().octets(), [198, 18 | 19, ..]) { continue; }
        let Some(policy) = &bundle.policy else { continue; };
        if !policy.proxy_tcp || !Filters::parse(policy).is_ok_and(|filters| {
            filters.accepts(socket.remote.port(), None, Some(address)) == Some(true)
        }) { continue; }
        let Some(path) = process.executable_path.as_ref() else { continue; };
        let owner = Identity { pid: process.pid, created_at: process.created_at, path: path.clone() };
        if let Some(job) = changes.get_mut(bundle.id.as_str()) {
            job.sockets.push((socket, owner));
        }
    }
}
