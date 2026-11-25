//! Scoped transparent TCP and SOCKS UDP relay. Two receive threads and a bounded
//! Tokio worker pool; no full process-table scan in the packet path.
use super::{
    dns::{blocked_ipv6_reply, Question},
    driver::{Address, Device},
    firewall::RelayFirewall,
    ownership::{Event, Identity, Index},
    packet::{capture_bypass_destination, Flow, Packet},
    plan::Plan,
    preflight::VerifiedApi,
};
use crate::capture::{suite_dns::Mode as DnsMode, ConnectionEvidence, ConnectionOutcome};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{mpsc, Semaphore},
};

#[cfg(windows)]
pub fn configure_socket_keepalive(raw_sock: std::os::windows::io::RawSocket) {
    use windows_sys::Win32::Networking::WinSock::*;
    #[link(name = "ws2_32")]
    extern "system" {
        fn WSAIoctl(
            s: usize,
            dwiocontrolcode: u32,
            lpvinbuffer: *const core::ffi::c_void,
            cbinbuffer: u32,
            lpvoutbuffer: *mut core::ffi::c_void,
            cboutbuffer: u32,
            lpcbbytesreturned: *mut u32,
            lpoverlapped: *mut core::ffi::c_void,
            lpcompletionroutine: *mut core::ffi::c_void,
        ) -> i32;
    }
    unsafe {
        let optval: i32 = 1;
        setsockopt(
            raw_sock as usize,
            SOL_SOCKET,
            SO_KEEPALIVE,
            &optval as *const _ as *const u8,
            std::mem::size_of_val(&optval) as i32,
        );
        #[repr(C)]
        struct TcpKeepAliveSetting {
            onoff: u32,
            keepalivetime: u32,
            keepaliveinterval: u32,
        }
        let mut setting = TcpKeepAliveSetting {
            onoff: 1,
            keepalivetime: 15_000,
            keepaliveinterval: 3_000,
        };
        let mut bytes_returned = 0u32;
        WSAIoctl(
            raw_sock as usize,
            SIO_KEEPALIVE_VALS,
            &mut setting as *mut _ as *const core::ffi::c_void,
            std::mem::size_of_val(&setting) as u32,
            std::ptr::null_mut(),
            0,
            &mut bytes_returned,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );
    }
}

fn is_fake_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let b = v4.octets();
            b[0] == 198 && (b[1] == 18 || b[1] == 19)
        }
        IpAddr::V6(v6) => v6.segments()[..6] == [0xfd00, 0x5057, 0x646e, 0x7300, 0, 0],
    }
}

fn external_ipv6(ip: IpAddr) -> bool {
    let IpAddr::V6(ip) = ip else { return false };
    let words = ip.segments();
    words[0] & 0xe000 == 0x2000
        || (words[..2] == [0x64, 0xff9b]
            && (words[2..6] == [0; 4] || words[2] == 1))
}

#[derive(Default, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stats {
    pub active: bool,
    pub tcp: u64,
    pub udp: u64,
    pub dns: u64,
    pub unknown: u64,
    pub failures: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent_connections: Vec<ConnectionEvidence>,
}
#[derive(Clone)]
struct FlowEvidence {
    id: u64,
    pid: u32,
    process_name: String,
    owner: Option<String>,
    entry_port: Option<u16>,
    dns_name: Option<String>,
    dns_upstream: Option<String>,
}
impl FlowEvidence {
    fn describe_dns(&mut self, question: &Question) {
        self.dns_name = Some(question.name.clone());
        self.dns_upstream = Some(crate::commands::dns::DEFAULT_FALLBACK_DOH.into());
    }
}

const CONNECTION_EVIDENCE_LIMIT: usize = 48;

fn remember_connection(events: &mut VecDeque<ConnectionEvidence>, event: ConnectionEvidence) {
    if events.len() == CONNECTION_EVIDENCE_LIMIT {
        events.pop_front();
    }
    events.push_back(event);
}

struct Route {
    external: Option<crate::external_proxy::captured::Context>,
    identity: Option<Identity>,
    owned_dns: bool,
    flow: Flow,
    token: u16,
    port: u16,
    touched: Mutex<Instant>,
    claimed: AtomicBool,
    finished: AtomicBool,
    ipv6_revoked: AtomicBool,
    cancel: tokio::sync::Notify,
    evidence: Option<FlowEvidence>,
}
#[derive(Default)]
struct Tables {
    flows: HashMap<Flow, Arc<Route>>,
    tokens: HashMap<u16, Arc<Route>>,
    udp: HashMap<Flow, (u64, super::ownership::Owner, mpsc::Sender<Vec<u8>>)>,
    bypass: HashMap<Flow, Instant>,
    nat: crate::capture::local_proxy::Nat,
    next: u16,
    generation: u64,
}
fn withdraw_routes(table: &mut Tables, old: &Plan, next: &Plan) {
    // 平滑过渡：规则更新时，允许已建立且正在传输的现有 TCP 连接继续平稳通信，
    // 绝不过早暴力拆除或通知 cancel，保证现有长连接和流式通信不被配置更新打断；
    // 新发起的连接（新 SYN）将自动采用新计划中的端口映射。
    table.udp.retain(|flow, (_, owner, _)| {
        let identity = &owner.identity;
        let Some((before_owner, Some(before_port))) = old.destination_for(&identity.path, identity.pid, identity.created_at) else { return false };
        let Some((after_owner, Some(after_port))) = next.destination_for(&identity.path, identity.pid, identity.created_at) else { return false };
        flow.protocol == 17 && before_port == after_port
            && (flow.destination.port() != 53 || (old.uses_owned_dns(before_owner) == next.uses_owned_dns(after_owner)
                && old.uses_sandbox_dns(before_owner) == next.uses_sandbox_dns(after_owner)
                && old.dns_mode(before_owner) == next.dns_mode(after_owner)
                && old.native_dns_servers == next.native_dns_servers))
            && !(external_ipv6(flow.destination.ip()) && next.blocks_ipv6(after_owner))
    });
    if !next.block_ipv6_owners.is_empty() {
        for route in table.flows.values().filter(|route| !route.owned_dns && external_ipv6(route.flow.destination.ip())) {
            let blocked = route.identity.as_ref().and_then(|identity| {
                next.destination_for(&identity.path, identity.pid, identity.created_at)
            }).is_some_and(|(owner, _)| next.blocks_ipv6(owner));
            if blocked && !route.ipv6_revoked.swap(true, Ordering::AcqRel) {
                route.finished.store(true, Ordering::Release);
                route.cancel.notify_one();
            }
        }
    }
}
struct Shared {
    external: bool,
    plan: RwLock<Plan>,
    network: Arc<Device>,
    sockets: Arc<Device>,
    owners: Mutex<Index>,
    table: Mutex<Tables>,
    stop: AtomicBool,
    paused: AtomicBool,
    v4: u16,
    v6: u16,
    excluded: Vec<Identity>,
    worker: tokio::runtime::Handle,
    test_loopback: bool,
    capacity: Arc<Semaphore>,
    dns_capacity: Arc<Semaphore>,
    tcp: AtomicU64,
    udp: AtomicU64,
    dns: AtomicU64,
    unknown: AtomicU64,
    failures: AtomicU64,
    connection_sequence: AtomicU64,
    recent_connections: Mutex<VecDeque<ConnectionEvidence>>,
}

impl Shared {
    fn flow_evidence(&self, identity: &Identity, owner: &str, port: Option<u16>) -> FlowEvidence {
        FlowEvidence {
            id: self.connection_sequence.fetch_add(1, Ordering::Relaxed) + 1,
            pid: identity.pid,
            process_name: identity
                .path
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or_default()
                .chars()
                .take(120)
                .collect(),
            owner: (!owner.is_empty()).then(|| owner.to_owned()),
            entry_port: port,
            dns_name: None,
            dns_upstream: None,
        }
    }

    fn record_connection(
        &self,
        evidence: Option<&FlowEvidence>,
        flow: Flow,
        stage: &str,
        outcome: ConnectionOutcome,
        error_kind: Option<String>,
    ) {
        let Some(evidence) = evidence else { return };
        let event = ConnectionEvidence {
            connection_id: evidence.id,
            time_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            pid: evidence.pid,
            process_name: evidence.process_name.clone(),
            rule_owner: evidence.owner.clone(),
            entry_port: evidence.entry_port,
            destination: flow.destination.to_string(),
            protocol: if flow.protocol == 6 { "tcp" } else { "udp" }.into(),
            stage: stage.into(),
            outcome,
            error_kind,
            dns_name: evidence.dns_name.clone(),
            dns_upstream: evidence.dns_upstream.clone(),
        };
        remember_connection(&mut self.recent_connections.lock().unwrap(), event);
    }

    fn connection_failure(
        &self,
        evidence: Option<&FlowEvidence>,
        flow: Flow,
        stage: &str,
        error_kind: &str,
    ) {
        self.failures.fetch_add(1, Ordering::Relaxed);
        self.record_connection(
            evidence, flow, stage, ConnectionOutcome::Failed, Some(error_kind.into()),
        );
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FilterKey {
    has_targets: bool,
    managed_ports: std::collections::BTreeSet<u16>,
}

fn compute_filter_key(plan: &Plan) -> FilterKey {
    let mut managed_ports: std::collections::BTreeSet<u16> =
        plan.managed_endpoints.iter().map(|a| a.port()).collect();
    if let Some(p) = plan.mixed_port {
        managed_ports.insert(p);
    }
    if managed_ports.is_empty() {
        managed_ports.insert(7890);
    }
    let has_targets = !plan.targets.is_empty() || !plan.instances.is_empty() || plan.has_dns();
    FilterKey {
        has_targets,
        managed_ports,
    }
}

pub struct Engine {
    shared: Arc<Shared>,
    threads: Vec<JoinHandle<()>>,
    pool: Option<tokio::runtime::Runtime>,
    filter_key: FilterKey,
    firewall: Option<Mutex<RelayFirewall>>,
}
impl Engine {
    pub fn start(
        plan: Plan,
        components: &std::path::Path,
        excluded: Vec<Identity>,
    ) -> Result<Self, String> {
        Self::start_backend(plan, components, excluded, None, false)
    }
    pub(crate) fn start_external(components: &std::path::Path, excluded: Vec<Identity>) -> Result<Self,String> {
        Self::start_backend(Plan::default(), components, excluded, None, true)
    }
    #[cfg(test)] pub(crate) fn external_fixture(components:&std::path::Path,excluded:Vec<Identity>,filter:&str)->Result<Self,String>{
        Self::start_backend(Plan::default(),components,excluded,Some(filter),true)
    }
    #[cfg(test)]
    fn start_inner(
        plan: Plan,
        components: &std::path::Path,
        excluded: Vec<Identity>,
        filter: Option<&str>,
    ) -> Result<Self, String> {
        Self::start_backend(plan,components,excluded,filter,false)
    }
    fn start_backend(plan:Plan,components:&std::path::Path,excluded:Vec<Identity>,filter:Option<&str>,external:bool)->Result<Self,String> {
        plan.validate()?;
        let pool = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .max_blocking_threads(8)
            .enable_all()
            .build()
            .map_err(|_| "创建接管任务池失败")?;
        let guard = pool.enter();
        let v4 = std::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
            .map_err(|_| "IPv4 转发入口创建失败")?;
        let v6 = std::net::TcpListener::bind((Ipv6Addr::UNSPECIFIED, 0))
            .map_err(|_| "IPv6 转发入口创建失败")?;
        v4.set_nonblocking(true).map_err(|_| "转发入口配置失败")?;
        v6.set_nonblocking(true).map_err(|_| "转发入口配置失败")?;
        let ports = (
            v4.local_addr().unwrap().port(),
            v6.local_addr().unwrap().port(),
        );
        let v4 = TcpListener::from_std(v4).map_err(|_| "转发入口创建失败")?;
        let v6 = TcpListener::from_std(v6).map_err(|_| "转发入口创建失败")?;
        let filter_key = compute_filter_key(&plan);
        let firewall = if filter.is_none() && (external || filter_key.has_targets) {
            Some(Mutex::new(RelayFirewall::start([ports.0, ports.1])?))
        } else {
            None
        };
        let loaded = VerifiedApi::load(components)?;
        let sockets = loaded
            .api
            .open("protocol == 6 or protocol == 17", 3, 1 | 4)?;
        if sockets.version().map_err(|_| "驱动版本读取失败")? != (2, 2) {
            return Err("WinDivert 共享驱动版本不兼容".into());
        }
        let managed_ports = &filter_key.managed_ports;
        let port_filter = managed_ports.iter().map(|p| format!("tcp.DstPort == {p}")).collect::<Vec<_>>().join(" or ");
        let default_filter = if !external && !filter_key.has_targets {
            "false".to_string()
        } else {
            format!("(outbound and !loopback and (tcp or udp)) or (loopback and tcp and (({port_filter}) or (tcp.SrcPort >= 61000 and tcp.SrcPort <= 64999)))")
        };
        let filter_text = filter
            .map(|f| f.to_string())
            .unwrap_or(default_filter)
            .replace("{relay4}", &ports.0.to_string())
            .replace("{relay6}", &ports.1.to_string());
        let network_device = loaded.api.open(&filter_text, 0, 0)?;
        // 扩容内核队列至 8192，避免突发高吞吐时内核丢包 (WINDIVERT_PARAM_QUEUE_LEN = 0)
        let _ = network_device.set_param(0, 8192);
        // 设置队列超时为 1500ms (WINDIVERT_PARAM_QUEUE_TIME = 1)
        let _ = network_device.set_param(1, 1500);
        let shared = Arc::new(Shared {
            external,
            plan: RwLock::new(plan),
            network: network_device,
            sockets,
            owners: Mutex::new(Index::default()),
            table: Mutex::new(Tables::default()),
            stop: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            v4: ports.0,
            v6: ports.1,
            excluded,
            worker: pool.handle().clone(),
            test_loopback: cfg!(test) && filter.is_some(),
            capacity: Arc::new(Semaphore::new(4096)),
            dns_capacity: Arc::new(Semaphore::new(64)),
            tcp: AtomicU64::new(0),
            udp: AtomicU64::new(0),
            dns: AtomicU64::new(0),
            unknown: AtomicU64::new(0),
            failures: AtomicU64::new(0),
            connection_sequence: AtomicU64::new(0),
            recent_connections: Mutex::new(VecDeque::with_capacity(CONNECTION_EVIDENCE_LIMIT)),
        });
        for listener in [v4, v6] {
            pool.spawn(accept(shared.clone(), listener));
        }
        let s = shared.clone();
        let observer = std::thread::spawn(move || observe(s));
        let s = shared.clone();
        let receiver = std::thread::spawn(move || network(s));
        drop(guard);
        Ok(Self {
            shared,
            threads: vec![observer, receiver],
            pool: Some(pool),
            filter_key,
            firewall,
        })
    }
    pub(crate) fn refresh_relay_firewall(&self) -> Result<(), String> {
        if let Some(firewall) = &self.firewall {
            firewall.lock().unwrap().refresh()?;
        }
        Ok(())
    }
    pub fn matches_filter(&self, plan: &Plan) -> bool {
        self.filter_key == compute_filter_key(plan)
    }
    pub fn update(&self, plan: Plan) -> Result<(), String> {
        if self.shared.stop.load(Ordering::Acquire) {
            return Err("接管工作线程已停止".into());
        }
        plan.validate()?;
        let mut current = self.shared.plan.write().unwrap();
        if !self.shared.external {
            let mut table = self.shared.table.lock().unwrap();
            withdraw_routes(&mut table, &current, &plan);
        }
        *current = plan;
        self.shared.paused.store(false, Ordering::Release);
        Ok(())
    }
    pub fn has_targets(&self) -> bool {
        let plan = self.shared.plan.read().unwrap();
        !plan.targets.is_empty() || !plan.instances.is_empty() || plan.has_dns()
    }
    pub fn update_instances(&self, instances: Vec<super::plan::Instance>) -> Result<(), String> {
        if self.shared.stop.load(Ordering::Acquire) || self.shared.paused.load(Ordering::Acquire) {
            return Err("接管已暂停，不能单独更新实例".into());
        }
        let mut guard = self.shared.plan.write().unwrap();
        let mut next = guard.clone(); next.instances = instances; next.validate()?;
        if (guard.targets.is_empty() && !guard.has_dns() && guard.instances.is_empty() != next.instances.is_empty())
            || guard.has_dns() != next.has_dns()
        {
            return Err("接管范围改变，需要完整确认".into());
        }
        if !self.shared.external && !next.block_ipv6_owners.is_empty() {
            withdraw_routes(&mut self.shared.table.lock().unwrap(), &guard, &next);
        }
        *guard = next;
        Ok(())
    }
    pub fn pause(&self) {
        self.shared.paused.store(true, Ordering::Release);
    }
    pub fn stats(&self) -> Stats {
        let s = &self.shared;
        Stats {
            active: !s.stop.load(Ordering::Acquire) && !s.paused.load(Ordering::Acquire),
            tcp: s.tcp.load(Ordering::Relaxed),
            udp: s.udp.load(Ordering::Relaxed),
            dns: s.dns.load(Ordering::Relaxed),
            unknown: s.unknown.load(Ordering::Relaxed),
            failures: s.failures.load(Ordering::Relaxed),
            recent_connections: s.recent_connections.lock().unwrap().iter().rev().cloned().collect(),
        }
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        // Stop accepting new flows, terminate our relays while reverse mappings
        // still exist, then drain queued packets and release only our handles.
        self.shared.paused.store(true, Ordering::Release);
        if let Some(pool) = self.pool.take() {
            pool.shutdown_timeout(Duration::from_secs(2));
        }
        self.shared.stop.store(true, Ordering::Release);
        self.shared.sockets.shutdown();
        self.shared.network.shutdown();
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}
fn observe(s: Arc<Shared>) {
    while let Ok((_, address)) = s.sockets.recv(&mut []) {
        if s.stop.load(Ordering::Acquire) {
            break;
        }
        if let Some(event) = Event::decode(&address) {
            let identity = if event.kind == super::ownership::Kind::Close {
                None
            } else {
                event_identity(&event)
            };
            if s.owners.lock().unwrap().apply(event, identity).is_err() {
                s.failures.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
    if !s.stop.swap(true, Ordering::AcqRel) {
        s.owners.lock().unwrap().invalidate();
        s.failures.fetch_add(1, Ordering::Relaxed);
        s.network.shutdown();
    }
}
fn event_identity(event: &Event) -> Option<Identity> {
    identity_at(event.pid, event.timestamp)
}
fn identity_at(pid: u32, timestamp: i64) -> Option<Identity> {
    #[link(name = "kernel32")]
    extern "system" {
        fn QueryPerformanceCounter(value: *mut i64) -> i32;
        fn QueryPerformanceFrequency(value: *mut i64) -> i32;
    }
    let id = Identity::inspect(pid)?;
    let (mut now, mut frequency) = (0i64, 0i64);
    if unsafe { QueryPerformanceCounter(&mut now) } == 0
        || unsafe { QueryPerformanceFrequency(&mut frequency) } == 0
        || frequency <= 0
        || timestamp > now
    {
        return None;
    }
    let wall = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos()
        / 100
        + 116444736000000000;
    let elapsed = now.checked_sub(timestamp)? as u128 * 10000000 / frequency as u128;
    let at = wall.checked_sub(elapsed)?;
    // The PID must have existed when WinDivert observed the event or packet.
    (u128::from(id.created_at) <= at).then_some(id)
}

fn live_table_owner(flow: Flow, timestamp: i64) -> Option<super::ownership::Owner> {
    let pid = if flow.protocol == 6 {
        super::tcp_owner(flow.source, flow.destination)
    } else {
        super::udp_owner(flow.source)
    }?;
    Some(super::ownership::Owner {
        endpoint: 0,
        observed_at: timestamp,
        identity: identity_at(pid, timestamp)?,
    })
}

fn send(s: &Shared, data: &mut [u8], address: &mut Address, changed: bool) -> bool {
    let sent = s.network.send(data, address, changed).is_ok();
    if !sent {
        s.failures.fetch_add(1, Ordering::Relaxed);
    }
    sent
}
fn reflect(s: &Shared, p: &Packet, r: &Route, data: &mut [u8], a: &mut Address) -> bool {
    p.rewrite(
        data,
        SocketAddr::new(r.flow.destination.ip(), r.token),
        SocketAddr::new(
            r.flow.source.ip(),
            if r.flow.source.is_ipv4() { s.v4 } else { s.v6 },
        ),
    );
    if a.flags & (1 << 18) == 0 {
        a.inbound();
    }
    send(s, data, a, true)
}
fn network(s: Arc<Shared>) {
    let mut data = vec![0; 65575];
    let mut cleanup = Instant::now();
    let mut diagnostic_summary = Instant::now();
    while let Ok((n, mut address)) = s.network.recv(&mut data) {
        let data = &mut data[..n];
        let Some(packet) = Packet::parse(data) else {
            s.unknown.fetch_add(1, Ordering::Relaxed);
            send(&s, data, &mut address, false);
            continue;
        };
        let flow = packet.flow;
        let dns_destination = !s.external && flow.destination.port() == 53;
        let protected_ipv6 = external_ipv6(flow.destination.ip());
        let ipv6_policy_active = protected_ipv6 && !s.external && !s.plan.read().unwrap().block_ipv6_owners.is_empty();
        let existing_tcp = flow.protocol == 6 && !packet.syn;
        if cleanup.elapsed() > Duration::from_secs(2) {
            let mut t = s.table.lock().unwrap();
            t.flows.retain(|_, r| {
                let age = r.touched.lock().unwrap().elapsed();
                r.claimed.load(Ordering::Acquire) && !r.finished.load(Ordering::Acquire)
                    || age < Duration::from_secs(30)
            });
            let active: std::collections::HashSet<_> = t.flows.values().map(|r| r.token).collect();
            t.tokens.retain(|k, _| active.contains(k));
            t.bypass
                .retain(|_, at| at.elapsed() < Duration::from_secs(2));
            t.nat.cleanup();
            if s.external && diagnostic_summary.elapsed()>=Duration::from_secs(30) {
                crate::external_proxy::diagnostics::emit("capture.snapshot","info",serde_json::json!({"tcpFlows":t.flows.len(),"udpFlows":t.udp.len(),"bypassedFlows":t.bypass.len(),"permitsAvailable":s.capacity.available_permits(),
                    "tcp":s.tcp.load(Ordering::Relaxed),"udp":s.udp.load(Ordering::Relaxed),"dns":s.dns.load(Ordering::Relaxed),"unknown":s.unknown.load(Ordering::Relaxed),"failures":s.failures.load(Ordering::Relaxed)}));
                diagnostic_summary=Instant::now();
            }
            cleanup = Instant::now();
        }
        if flow.protocol == 6 {
            // 0. 本地回环系统代理双向 NAT 映射检查（非纯 SYN 的已建连/后续报文直接快速转换）
            let is_fin_or_rst = packet.is_fin_or_rst(data);
            let is_ack = packet.is_ack(data);
            if !packet.syn {
                let nat_translated = s.table.lock().unwrap().nat.translate(flow, is_fin_or_rst, is_ack);
                if let Some(target_flow) = nat_translated {
                    packet.rewrite(data, target_flow.source, target_flow.destination);
                    send(&s, data, &mut address, true);
                    continue;
                }
            }

            let reverse = if flow.source.port() == s.v4 || flow.source.port() == s.v6 {
                s.table
                    .lock()
                    .unwrap()
                    .tokens
                    .get(&flow.destination.port())
                    .cloned()
                    .filter(|r| {
                        r.flow.source.ip() == flow.source.ip()
                            && r.flow.destination.ip() == flow.destination.ip()
                    })
            } else {
                None
            };
            if let Some(r) = reverse {
                if r.ipv6_revoked.load(Ordering::Acquire) {
                    continue;
                }
                *r.touched.lock().unwrap() = Instant::now();
                packet.rewrite(data, r.flow.destination, r.flow.source);
                if address.flags & (1 << 18) == 0 {
                    address.inbound();
                }
                send(&s, data, &mut address, true);
                continue;
            }
            let route = s.table.lock().unwrap().flows.get(&flow).cloned();
            if let Some(r) = route {
                if packet.syn && r.finished.load(Ordering::Acquire) {
                    let mut t = s.table.lock().unwrap();
                    t.flows.remove(&flow);
                    t.tokens.remove(&r.token);
                } else {
                    if r.ipv6_revoked.load(Ordering::Acquire) {
                        continue;
                    }
                    *r.touched.lock().unwrap() = Instant::now();
                    reflect(&s, &packet, &r, data, &mut address);
                    continue;
                }
            }
            if existing_tcp && !ipv6_policy_active && !dns_destination {
                send(&s, data, &mut address, false);
                continue;
            }
        }
        let is_loopback = flow.destination.ip().is_loopback() || address.flags & (1 << 18) != 0;
        let is_to_sysproxy = flow.protocol == 6 && packet.syn && s.plan.read().unwrap().managed_endpoints.contains(&flow.destination);

        // 普通回环连接（非发往 ProcWeaver 托管之系统代理的 SYN 者）直接原样放行，
        // 彻底杜绝本地开发服务器、IPC 管道和调试端口被误劫持
        if ((is_loopback && !is_to_sysproxy)
            || capture_bypass_destination(flow.destination.ip()))
            && !s.test_loopback
            || s.stop.load(Ordering::Acquire)
        {
            send(&s, data, &mut address, false);
            continue;
        }
        if flow.protocol == 17 {
            let cached = s.table.lock().unwrap().udp.get(&flow).cloned();
            if let Some((_, owner, tx)) = cached {
                let valid = if owner.endpoint == 0 {
                    super::owner::lookup(flow) == Some(owner.identity.pid)
                        && Identity::inspect(owner.identity.pid).as_ref() == Some(&owner.identity)
                } else {
                    s.owners.lock().unwrap().current(&owner)
                };
                if valid {
                    if ipv6_policy_active {
                        let identity = &owner.identity;
                        let plan = s.plan.read().unwrap();
                        if let Some((rule, port)) = plan.destination_for(&identity.path, identity.pid, identity.created_at) {
                            if plan.blocks_ipv6(rule) {
                                s.table.lock().unwrap().udp.remove(&flow);
                                let evidence = s.flow_evidence(identity, rule, port);
                                s.record_connection(Some(&evidence), flow, "ipv6_policy", ConnectionOutcome::Failed, Some("Ipv6Blocked".into()));
                                continue;
                            }
                        }
                    }
                    if tx.try_send(data[packet.payload..].to_vec()).is_err() {
                        s.failures.fetch_add(1, Ordering::Relaxed);
                    } else {
                        s.udp.fetch_add(1, Ordering::Relaxed);
                    }
                    continue;
                }
                s.table.lock().unwrap().udp.remove(&flow);
            }
        }
        if !ipv6_policy_active && !dns_destination && s.table.lock().unwrap().bypass.contains_key(&flow) {
            send(&s, data, &mut address, false);
            continue;
        }
        let mut owner = s.owners.lock().unwrap().resolve(
            flow.source,
            flow.destination,
            flow.protocol,
            address.timestamp,
            Identity::inspect,
        );
        // Fresh connections can reach the packet layer before the SOCKET event.
        // Check the live table and retry a bounded number of times before passing an unresolved packet.
        if owner.is_none() && (packet.syn || flow.protocol == 17 || ipv6_policy_active || dns_destination) {
            // 阶段 1: 短暂退让与重试（3 次 yield）
            for _ in 0..3 {
                std::thread::yield_now();
                owner = s.owners.lock().unwrap().resolve(
                    flow.source,
                    flow.destination,
                    flow.protocol,
                    address.timestamp,
                    Identity::inspect,
                );
                if owner.is_some() {
                    break;
                }
            }
            if owner.is_none() {
                owner = live_table_owner(flow, address.timestamp);
            }
            // Retry only after both ownership sources fail on the current packet.
            if owner.is_none() && packet.syn {
                let retry_until = Instant::now() + Duration::from_millis(5);
                for wait_us in [500, 1500, 3000] {
                    let remaining = retry_until.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        break;
                    }
                    std::thread::sleep(remaining.min(Duration::from_micros(wait_us)));
                    owner = s.owners.lock().unwrap().resolve(
                        flow.source,
                        flow.destination,
                        flow.protocol,
                        address.timestamp,
                        Identity::inspect,
                    );
                    if owner.is_some() {
                        break;
                    }
                    owner = live_table_owner(flow, address.timestamp);
                    if owner.is_some() {
                        break;
                    }
                }
            }
        }
        let is_excluded = owner.as_ref().is_some_and(|o| s.excluded.contains(&o.identity));
        let external = if s.external {
            match owner.as_ref().filter(|_|!is_excluded).map(|o|crate::external_proxy::captured::resolve(&o.identity)).transpose() {
                Ok(context)=>context.flatten(),
                Err(_)=>{s.failures.fetch_add(1,Ordering::Relaxed);continue;}
            }
        } else {None};
        // Hold the policy through route creation so an update can revoke any old IPv6 route.
        let plan = (!s.external).then(|| s.plan.read().unwrap());
        let mut evidence = None;
        let mut owned_dns = false;
        let choice = if s.external {
            external.as_ref().map(|_| 0)
        } else if let Some(identity) = owner.as_ref().filter(|_| !is_excluded).map(|o| &o.identity) {
            let plan = plan.as_ref().expect("the full engine has a routing plan");
            if let Some((rule_owner, port)) = plan.destination_for(&identity.path, identity.pid, identity.created_at) {
                evidence = Some(s.flow_evidence(identity, rule_owner, port));
                let dns_mode = plan.dns_mode(rule_owner);
                if dns_destination && !is_to_sysproxy && dns_mode == Some(DnsMode::SystemNative)
                    && plan.native_dns_servers.contains(&flow.destination.ip())
                {
                    if !existing_tcp {
                        s.record_connection(evidence.as_ref(), flow, "dns_native", ConnectionOutcome::Relayed, None);
                    }
                    send(&s, data, &mut address, false);
                    continue;
                }
                owned_dns = dns_destination && !is_to_sysproxy && plan.uses_owned_dns(rule_owner);
                // IPv6 DNS transport can be answered locally or translated to IPv4 DoH.
                // Only a new intercepted TCP session can enter the DNS relay.
                if protected_ipv6 && plan.blocks_ipv6(rule_owner) && (!owned_dns || existing_tcp) {
                    s.record_connection(evidence.as_ref(), flow, "ipv6_policy", ConnectionOutcome::Failed, Some("Ipv6Blocked".into()));
                    continue;
                }
                let Some(port) = port else {
                    s.connection_failure(evidence.as_ref(), flow, "rule_entry", "EntryUnavailable");
                    continue;
                };
                if !is_to_sysproxy && !owned_dns && !existing_tcp {
                    s.record_connection(evidence.as_ref(), flow, "ownership", ConnectionOutcome::Attributed, None);
                }
                Some(port)
            } else {
                None
            }
        } else {
            // A single available outlet is not evidence of process ownership.
            None
        };
        if existing_tcp {
            if owned_dns {
                // A previously direct DNS TCP connection cannot enter a SOCKS relay midstream.
                s.connection_failure(evidence.as_ref(), flow, "dns_policy", "PreviousDnsConnection");
                continue;
            }
            send(&s, data, &mut address, false);
            continue;
        }
        let Some(port) = choice else {
            if !is_excluded && !s.external && flow.protocol == 17 && flow.destination.port() == 53 {
                let payload = &data[packet.payload..];
                let matched_dns = super::dns::Question::parse_query(payload).and_then(|q| {
                    plan.as_ref()?.dns_port_for(&q.name).map(|dns_port| (q, dns_port))
                });
                if let Some((question, dns_port)) = matched_dns {
                    if s.paused.load(Ordering::Acquire) {
                        s.failures.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    let Ok(permit) = s.capacity.clone().try_acquire_owned() else {
                        s.failures.fetch_add(1, Ordering::Relaxed);
                        continue;
                    };
                    let query = payload.to_vec();
                    let template = data.to_vec();
                    let mut reply_address = address;
                    let shared = s.clone();
                    s.worker.spawn(async move {
                        let _permit = permit;
                        shared.dns.fetch_add(1, Ordering::Relaxed);
                        if dns_udp_relay(
                            &shared,
                            packet,
                            template,
                            &mut reply_address,
                            dns_port,
                            &query,
                            &question,
                        )
                        .await
                        .is_err()
                        {
                            shared.failures.fetch_add(1, Ordering::Relaxed);
                        }
                    });
                    continue;
                }
            }
            if is_fake_ip(flow.destination.ip()) {
                // 严禁将未知归属的 Fake-IP 数据包写入 bypass 并裸投物理网卡！
                // 物理网卡与外部网关无法路由 198.18.0.0/15，若写入 bypass 并放行会导致客户端 TCP 握手假死并触发断网；
                // 正确做法：直接丢弃此包（Drop，不调用 send，不插入 bypass），递增失败与未知计数。
                // 客户端协议栈随后重传 SYN，为系统连接表与 WFP 异步事件反查争取窗口期。
                s.failures.fetch_add(1, Ordering::Relaxed);
                if owner.is_none() {
                    s.unknown.fetch_add(1, Ordering::Relaxed);
                }
                continue;
            }
            if owner.is_none() {
                s.unknown.fetch_add(1, Ordering::Relaxed);
            }
            // 核心修复：绝不把未确认归属的 SYN 首包写入 bypass！
            // 只有当明确识别出归属实例、且该实例确定不需要代理时，才写入 bypass 缓存；
            // 对于未确认归属的 SYN，放行当前包但不记入 bypass，允许后续重传 SYN 再次尝试核验，杜绝连接永久脱缰！
            if (flow.protocol != 17 || flow.destination.port() != 53) && !packet.syn && owner.is_some() {
                let mut table = s.table.lock().unwrap();
                if table.bypass.len() < 4096 {
                    table.bypass.insert(flow, Instant::now());
                }
                drop(table);
            }
            if is_to_sysproxy {
                // 关键防御：无论之前是否存在旧映射，新连接未匹配规则，强制抹除该客户端源端口在 NAT 表中的旧残留
                s.table.lock().unwrap().nat.forget(flow);
            }
            send(&s, data, &mut address, false);
            continue;
        };
        // A confirmed target must never fall back directly on relay failure.
        if s.paused.load(Ordering::Acquire) {
            s.connection_failure(evidence.as_ref(), flow, "routing", "CapturePaused");
            continue;
        }
        if owned_dns && flow.protocol == 17 {
            let mut evidence = evidence.expect("owned DNS is positively attributed");
            let mode = evidence.owner.as_deref().and_then(|owner| {
                plan.as_ref().and_then(|plan| plan.dns_mode(owner))
            }).unwrap_or_default();
            let sandbox = evidence.owner.as_deref().is_some_and(|owner| {
                plan.as_ref().is_some_and(|plan| plan.uses_sandbox_dns(owner))
            });
            let stage = OwnedDnsPolicy { sandbox, mode, block_ipv6: false }.stage();
            let payload = &data[packet.payload..];
            let Some(question) = Question::parse_query(payload) else {
                s.connection_failure(Some(&evidence), flow, "dns_validation", "InvalidQuery");
                continue;
            };
            evidence.describe_dns(&question);
            if sandbox { evidence.dns_upstream = None; }
            s.record_connection(Some(&evidence), flow, "ownership", ConnectionOutcome::Attributed, None);
            let Ok(permit) = s.dns_capacity.clone().try_acquire_owned() else {
                s.connection_failure(Some(&evidence), flow, stage, "RelayCapacity");
                continue;
            };
            let owner = owner.expect("owned DNS has a verified process identity");
            let template = data.to_vec();
            let shared = s.clone();
            s.worker.spawn(async move {
                let _permit = permit;
                match owned_dns_udp(&shared, packet, template, address, &owner, &evidence, &question, port).await {
                    Ok(stage) => {
                        if stage != "dns_doh" { evidence.dns_upstream = None; }
                        shared.record_connection(Some(&evidence), flow, stage, ConnectionOutcome::Relayed, None);
                    }
                    Err(error) => shared.connection_failure(Some(&evidence), flow, stage, &format!("{:?}", error.kind())),
                }
            });
            continue;
        }
        if flow.protocol == 6 {
            // 路径 B：连接 ProcWeaver 系统代理的受控流量，执行本地双向 NAT 重定向至该规则专属 Mixed 入口
            if is_to_sysproxy {
                let mut t = s.table.lock().unwrap();
                let opt_id = owner.as_ref().map(|o| o.identity.clone());
                // 区分同一五元组在 3 秒内的 SYN 重传：重传直接复用现有握手状态，避免反复推倒重建
                let is_retransmit = t.nat.is_syn_retransmission(flow, port);
                if !is_retransmit {
                    t.nat.forget(flow);
                    if !t.nat.insert(flow, port, opt_id) {
                        // 映射建立失败：绝不原样放行至公共代理，阻断该连接以守护严格指定出口契约
                        s.connection_failure(evidence.as_ref(), flow, "managed_redirect", "MappingUnavailable");
                        drop(t);
                        continue;
                    }
                }
                let target_ip: IpAddr = if flow.source.is_ipv4() {
                    std::net::Ipv4Addr::LOCALHOST.into()
                } else {
                    std::net::Ipv6Addr::LOCALHOST.into()
                };
                let translated = Flow {
                    destination: SocketAddr::new(target_ip, port),
                    ..flow
                };
                drop(t);
                packet.rewrite(data, translated.source, translated.destination);
                if !send(&s, data, &mut address, true) {
                    s.record_connection(evidence.as_ref(), flow, "managed_redirect", ConnectionOutcome::Failed, Some("PacketInjection".into()));
                    continue;
                }
                if !is_retransmit {
                    s.record_connection(evidence.as_ref(), flow, "managed_redirect", ConnectionOutcome::Attributed, None);
                }
                s.tcp.fetch_add(1, Ordering::Relaxed);
                continue;
            }

            let mut t = s.table.lock().unwrap();
            if t.flows.len() >= 8192 {
                s.connection_failure(evidence.as_ref(), flow, "packet_redirect", "FlowTableFull");
                continue;
            }
            let token = (0..50000).find_map(|_| {
                t.next = if t.next < 10000 || t.next >= 59999 {
                    10000
                } else {
                    t.next + 1
                };
                (!t.tokens.contains_key(&t.next)).then_some(t.next)
            });
            let Some(token) = token else {
                s.connection_failure(evidence.as_ref(), flow, "packet_redirect", "RelayTokenUnavailable");
                continue;
            };
            let route = Arc::new(Route {
                external,
                identity: (!s.external).then(|| owner.expect("a full route has a verified process identity").identity),
                owned_dns,
                flow,
                token,
                port,
                touched: Mutex::new(Instant::now()),
                claimed: AtomicBool::new(false),
                finished: AtomicBool::new(false),
                ipv6_revoked: AtomicBool::new(false),
                cancel: tokio::sync::Notify::new(),
                evidence,
            });
            t.tokens.insert(token, route.clone());
            t.flows.insert(flow, route.clone());
            drop(t);
            if !reflect(&s, &packet, &route, data, &mut address) {
                s.record_connection(route.evidence.as_ref(), flow, "packet_redirect", ConnectionOutcome::Failed, Some("PacketInjection".into()));
            }
        } else {
            let permit = match s.capacity.clone().try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    s.connection_failure(evidence.as_ref(), flow, "udp_relay", "RelayCapacity");
                    continue;
                }
            };
            let mut t = s.table.lock().unwrap();
            if t.udp.len() >= 1024 {
                s.connection_failure(evidence.as_ref(), flow, "udp_relay", "FlowTableFull");
                continue;
            }
            let owner = owner.expect("a selected route has a verified owner");
            let (tx, rx) = mpsc::channel(16);
            let _ = tx.try_send(data[packet.payload..].to_vec());
            t.generation = t.generation.wrapping_add(1);
            let generation = t.generation;
            t.udp.insert(flow, (generation, owner.clone(), tx));
            drop(t);
            let template = data.to_vec();
            let shared = s.clone();
            s.worker.spawn(async move {
                let _permit = permit;
                if let Err(error) = udp(
                    shared.clone(),
                    packet,
                    template,
                    address,
                    port,
                    rx,
                    generation,
                    owner,
                    external,
                    evidence.as_ref(),
                )
                .await
                {
                    shared.connection_failure(
                        evidence.as_ref(), flow, "udp_relay", &format!("{:?}", error.kind()),
                    );
                }
                let mut t = shared.table.lock().unwrap();
                if t.udp.get(&flow).is_some_and(|(g, _, _)| *g == generation) {
                    t.udp.remove(&flow);
                }
            });
            s.udp.fetch_add(1, Ordering::Relaxed);
        }
    }
    if !s.stop.swap(true, Ordering::AcqRel) {
        s.failures.fetch_add(1, Ordering::Relaxed);
        s.sockets.shutdown();
        s.network.shutdown();
    }
}
async fn accept(s: Arc<Shared>, listener: TcpListener) {
    while let Ok((mut stream, peer)) = listener.accept().await {
        let _ = stream.set_nodelay(true);
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawSocket;
            configure_socket_keepalive(stream.as_raw_socket());
        }
        let route = s
            .table
            .lock()
            .unwrap()
            .tokens
            .get(&peer.port())
            .cloned()
            .filter(|r| {
                r.flow.destination.ip() == peer.ip()
                    && stream
                        .local_addr()
                        .is_ok_and(|a| a.ip() == r.flow.source.ip())
            });
        let Some(route) = route else {
            continue;
        };
        if route.ipv6_revoked.load(Ordering::Acquire) || route.claimed.swap(true, Ordering::AcqRel) {
            continue;
        }
        let Ok(permit) = s.capacity.clone().try_acquire_owned() else {
            route.finished.store(true, Ordering::Release);
            s.connection_failure(route.evidence.as_ref(), route.flow, "tcp_relay", "RelayCapacity");
            continue;
        };
        let shared = s.clone();
        s.worker.spawn(async move {
            let _permit = permit;
            shared.tcp.fetch_add(1, Ordering::Relaxed);
            let relay = async {
                if let Some(context)=route.external.clone() {
                    return crate::external_proxy::captured::tcp(context, stream, route.flow.destination)
                        .await
                        .map_err(|error| ("tcp_relay", std::io::Error::other(error)));
                }
                if route.owned_dns {
                    let identity = route.identity.as_ref().expect("owned DNS has a verified process identity");
                    return owned_dns_tcp(&shared, &mut stream, &route, identity)
                        .await
                        .map_err(|error| ("dns_doh", error));
                }
                let (mut upstream, _) = socks(route.port, route.flow.destination, false).await?;
                shared.record_connection(
                    route.evidence.as_ref(), route.flow, "socks_ingress", ConnectionOutcome::Relayed, None,
                );
                tokio::io::copy_bidirectional(&mut stream, &mut upstream)
                    .await
                    .map_err(|error| ("tcp_relay", error))?;
                Ok(())
            };
            let result = tokio::select! {
                result = relay => result,
                _ = route.cancel.notified() => Ok(()),
            };
            if let Err((stage, error)) = result {
                shared.connection_failure(
                    route.evidence.as_ref(), route.flow, stage, &format!("{:?}", error.kind()),
                );
            }
            route.finished.store(true, Ordering::Release);
            *route.touched.lock().unwrap() = Instant::now();
        });
    }
}

const DNS_MAX_WIRE_SIZE: usize = u16::MAX as usize;
const DNS_MESSAGE_MEDIA_TYPE: &str = "application/dns-message";

fn dns_http_error(error: reqwest::Error) -> io::Error {
    let kind = if error.is_timeout() {
        io::ErrorKind::TimedOut
    } else if error.is_connect() {
        io::ErrorKind::ConnectionRefused
    } else {
        io::ErrorKind::ConnectionAborted
    };
    kind.into()
}

fn validate_doh_answer(question: &Question, answer: &mut [u8]) -> io::Result<()> {
    let expected = Question { id: 0, ..question.clone() };
    if !expected.matches_reply(answer) || answer[2] & 0x02 != 0 {
        return Err(io::ErrorKind::InvalidData.into());
    }
    answer[..2].copy_from_slice(&question.id.to_be_bytes());
    Ok(())
}

async fn owned_doh(port: u16, query: &[u8], question: &Question) -> io::Result<Vec<u8>> {
    let proxy = reqwest::Proxy::all(format!("socks5h://127.0.0.1:{port}"))
        .map_err(dns_http_error)?;
    // One request per connection. Reusing a DoH tunnel after a rule update
    // could keep a retired outlet even when the loopback port is unchanged.
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(proxy)
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .http1_only()
        .pool_max_idle_per_host(0)
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(dns_http_error)?;
    let mut message = query.to_vec();
    message[..2].fill(0);
    let mut response = client
        .post(crate::commands::dns::DEFAULT_FALLBACK_DOH)
        .header(reqwest::header::CONTENT_TYPE, DNS_MESSAGE_MEDIA_TYPE)
        .header(reqwest::header::ACCEPT, DNS_MESSAGE_MEDIA_TYPE)
        .body(message)
        .send()
        .await
        .map_err(dns_http_error)?;
    if response.status() != reqwest::StatusCode::OK
        || !response.headers().get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.split(';').next().unwrap_or_default().trim().eq_ignore_ascii_case(DNS_MESSAGE_MEDIA_TYPE))
        || response.content_length().is_some_and(|size| size > DNS_MAX_WIRE_SIZE as u64)
    {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut answer = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(dns_http_error)? {
        if answer.len() + chunk.len() > DNS_MAX_WIRE_SIZE {
            return Err(io::ErrorKind::InvalidData.into());
        }
        answer.extend_from_slice(&chunk);
    }
    validate_doh_answer(question, &mut answer)?;
    Ok(answer)
}

#[derive(Clone, Copy)]
struct OwnedDnsPolicy {
    sandbox: bool,
    mode: DnsMode,
    block_ipv6: bool,
}

impl OwnedDnsPolicy {
    fn stage(self) -> &'static str {
        if self.mode == DnsMode::FakeIp { "dns_fake_ip" }
        else if self.sandbox { "dns_sandbox" }
        else { "dns_doh" }
    }
}

fn owned_dns_policy(s: &Shared, identity: &Identity, evidence: &FlowEvidence, port: u16) -> io::Result<OwnedDnsPolicy> {
    if s.stop.load(Ordering::Acquire) || s.paused.load(Ordering::Acquire) {
        return Err(io::ErrorKind::Interrupted.into());
    }
    let plan = s.plan.read().unwrap();
    let rule_owner = evidence.owner.as_deref().ok_or(io::ErrorKind::Interrupted)?;
    if !plan.uses_owned_dns(rule_owner)
        || plan.destination_for(&identity.path, identity.pid, identity.created_at) != Some((rule_owner, Some(port))) {
        return Err(io::ErrorKind::Interrupted.into());
    }
    Ok(OwnedDnsPolicy {
        sandbox: plan.uses_sandbox_dns(rule_owner),
        mode: plan.dns_mode(rule_owner).unwrap_or_default(),
        block_ipv6: plan.blocks_ipv6(rule_owner),
    })
}

fn local_ipv6_dns_answer(block_ipv6: bool, query: &[u8], question: &Question) -> Option<(Vec<u8>, &'static str)> {
    if !block_ipv6 {
        return None;
    }
    blocked_ipv6_reply(query, question).map(|answer| (answer, "dns_ipv6_policy"))
}

async fn sandbox_dns(port: u16, query: &[u8], question: &Question) -> io::Result<Vec<u8>> {
    // This destination terminates inside Mihomo on the verified suite inlet.
    let gateway = ([198, 19, 0, 1], 53).into();
    tokio::time::timeout(Duration::from_millis(900), async {
        let (mut stream, _) = socks(port, gateway, false).await.map_err(|(_, error)| error)?;
        stream.write_u16(query.len() as u16).await?;
        stream.write_all(query).await?;
        let reply = read_dns_frame(&mut stream).await?.ok_or(io::ErrorKind::UnexpectedEof)?;
        if !question.matches_reply(&reply) { return Err(io::ErrorKind::InvalidData.into()); }
        Ok(reply)
    }).await.map_err(|_| io::ErrorKind::TimedOut)?
}

async fn exchange_owned_dns(policy: OwnedDnsPolicy, port: u16, query: &[u8], question: &Question) -> io::Result<(Vec<u8>, &'static str)> {
    if let Some(answer) = local_ipv6_dns_answer(policy.block_ipv6, query, question) {
        return Ok(answer);
    }
    let answer = if policy.sandbox {
        sandbox_dns(port, query, question).await?
    } else {
        owned_doh(port, query, question).await?
    };
    Ok((answer, policy.stage()))
}

async fn owned_dns_udp(
    s: &Shared,
    packet: Packet,
    template: Vec<u8>,
    mut address: Address,
    owner: &super::ownership::Owner,
    evidence: &FlowEvidence,
    question: &Question,
    port: u16,
) -> io::Result<&'static str> {
    let policy = owned_dns_policy(s, &owner.identity, evidence, port)?;
    let query = &template[packet.payload..];
    s.dns.fetch_add(1, Ordering::Relaxed);
    let result = exchange_owned_dns(policy, port, query, question).await;
    let owner_current = if owner.endpoint == 0 {
        super::owner::lookup(packet.flow) == Some(owner.identity.pid)
            && Identity::inspect(owner.identity.pid).as_ref() == Some(&owner.identity)
    } else {
        s.owners.lock().unwrap().current_udp_flow(
            owner, packet.flow.source, packet.flow.destination, Identity::inspect,
        )
    };
    if !owner_current {
        return Err(io::ErrorKind::Interrupted.into());
    }
    let current = owned_dns_policy(s, &owner.identity, evidence, port)?;
    if current.sandbox != policy.sandbox || current.mode != policy.mode { return Err(io::ErrorKind::Interrupted.into()); }
    let result = local_ipv6_dns_answer(current.block_ipv6 && !policy.block_ipv6, query, question).map_or(result, Ok);
    let (answer, stage, failure) = match result {
        Ok((answer, stage)) => (crate::external_proxy::dns::fit_udp(query, answer), stage, None),
        Err(error) => (crate::external_proxy::dns::failure(query, 2), policy.stage(), Some(error)),
    };
    let mut response = packet.udp_reply(&template, &answer).ok_or(io::ErrorKind::InvalidData)?;
    if address.flags & (1 << 18) == 0 {
        address.inbound();
    }
    s.network.send(&mut response, &mut address, true)?;
    failure.map_or(Ok(stage), Err)
}

async fn read_dns_frame(stream: &mut TcpStream) -> io::Result<Option<Vec<u8>>> {
    let mut prefix = [0; 2];
    if stream.read(&mut prefix[..1]).await? == 0 {
        return Ok(None);
    }
    stream.read_exact(&mut prefix[1..]).await?;
    let size = usize::from(u16::from_be_bytes(prefix));
    if size < 12 {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut message = vec![0; size];
    stream.read_exact(&mut message).await?;
    Ok(Some(message))
}

async fn owned_dns_tcp(s: &Shared, stream: &mut TcpStream, route: &Route, identity: &Identity) -> io::Result<()> {
    let base = route.evidence.as_ref().expect("owned DNS has connection evidence");
    loop {
        let query = match tokio::time::timeout(Duration::from_secs(15), read_dns_frame(stream)).await {
            Ok(Ok(Some(query))) => query,
            Ok(Ok(None)) | Err(_) => return Ok(()),
            Ok(Err(error)) => return Err(error),
        };
        let Some(question) = Question::parse_query(&query) else {
            s.connection_failure(Some(base), route.flow, "dns_validation", "InvalidQuery");
            return Ok(());
        };
        let mut evidence = base.clone();
        evidence.describe_dns(&question);
        let policy = owned_dns_policy(s, identity, &evidence, route.port)?;
        if policy.sandbox { evidence.dns_upstream = None; }
        s.record_connection(Some(&evidence), route.flow, "ownership", ConnectionOutcome::Attributed, None);
        let result = match local_ipv6_dns_answer(policy.block_ipv6, &query, &question) {
            Some(answer) => {
                s.dns.fetch_add(1, Ordering::Relaxed);
                Ok(answer)
            }
            None => match s.dns_capacity.try_acquire() {
                Ok(_permit) => {
                    s.dns.fetch_add(1, Ordering::Relaxed);
                    exchange_owned_dns(policy, route.port, &query, &question).await
                }
                Err(_) => Err(io::ErrorKind::WouldBlock.into()),
            },
        };
        let current = owned_dns_policy(s, identity, &evidence, route.port)?;
        if current.sandbox != policy.sandbox || current.mode != policy.mode { return Err(io::ErrorKind::Interrupted.into()); }
        let result = local_ipv6_dns_answer(current.block_ipv6 && !policy.block_ipv6, &query, &question).map_or(result, Ok);
        let (answer, stage, failure) = match result {
            Ok((answer, stage)) => (answer, stage, None),
            Err(error) => (crate::external_proxy::dns::failure(&query, 2), policy.stage(), Some(error)),
        };
        tokio::time::timeout(Duration::from_secs(4), async {
            stream.write_u16(answer.len() as u16).await?;
            stream.write_all(&answer).await
        })
        .await
        .map_err(|_| io::ErrorKind::TimedOut)??;
        if let Some(error) = failure {
            s.connection_failure(Some(&evidence), route.flow, stage, &format!("{:?}", error.kind()));
        } else {
            if stage != "dns_doh" { evidence.dns_upstream = None; }
            s.record_connection(Some(&evidence), route.flow, stage, ConnectionOutcome::Relayed, None);
        }
    }
}

async fn socks(
    port: u16,
    destination: SocketAddr,
    udp: bool,
) -> Result<(TcpStream, SocketAddr), (&'static str, std::io::Error)> {
    let mut stage = "socks_ingress";
    let result = tokio::time::timeout(Duration::from_secs(8), async {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await?;
        stage = "socks_handshake";
        let _ = stream.set_nodelay(true);
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawSocket;
            configure_socket_keepalive(stream.as_raw_socket());
        }
        stream.write_all(&[5, 1, 0]).await?;
        let mut greeting = [0; 2];
        stream.read_exact(&mut greeting).await?;
        if greeting != [5, 0] {
            return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "SOCKS 认证失败"));
        }
        let mut request = vec![5, if udp { 3 } else { 1 }, 0];
        super::socks::encode(destination, &mut request);
        stage = "socks_reply";
        stream.write_all(&request).await?;
        let mut prefix = [0; 4];
        stream.read_exact(&mut prefix).await?;
        if prefix[..3] != [5, 0, 0] {
            return Err(std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "SOCKS 入口拒绝连接"));
        }
        let length = match prefix[3] {
            1 => 6,
            4 => 18,
            _ => return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "SOCKS 回应地址不支持")),
        };
        let mut data = vec![prefix[3]];
        data.resize(length + 1, 0);
        stream.read_exact(&mut data[1..]).await?;
        let (mut relay, _) =
            super::socks::decode(&data)
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "SOCKS 回应无效"))?;
        if relay.ip().is_unspecified() {
            relay.set_ip(if relay.is_ipv4() {
                IpAddr::V4(Ipv4Addr::LOCALHOST)
            } else {
                IpAddr::V6(Ipv6Addr::LOCALHOST)
            });
        }
        Ok((stream, relay))
    })
    .await;
    result.unwrap_or_else(|_| Err(std::io::ErrorKind::TimedOut.into()))
        .map_err(|error| (stage, error))
}
async fn udp(
    s: Arc<Shared>,
    p: Packet,
    template: Vec<u8>,
    mut address: Address,
    port: u16,
    mut rx: mpsc::Receiver<Vec<u8>>,
    generation: u64,
    owner: super::ownership::Owner,
    external: Option<crate::external_proxy::captured::Context>,
    evidence: Option<&FlowEvidence>,
) -> std::io::Result<()> {
    if let Some(context)=external {
        let (tx,mut replies)=mpsc::channel(16);
        let mut worker=tokio::spawn(crate::external_proxy::captured::udp(context,p.flow.destination,rx,tx));
        let mut completed=false;
        let result=loop {tokio::select! {
            result=&mut worker=>{completed=true;break result.map_err(std::io::Error::other)?.map_err(std::io::Error::other);},
            payload=replies.recv()=>{let Some(payload)=payload else{break Ok(());};
                let is_valid = if owner.endpoint == 0 {
                    super::owner::lookup(p.flow) == Some(owner.identity.pid)
                        && s.owners.lock().unwrap().current(&owner)
                } else {
                    s.owners.lock().unwrap().current(&owner)
                };
                if !is_valid || !s.table.lock().unwrap().udp.get(&p.flow).is_some_and(|(g,_,_)| *g == generation) {
                    break Ok(());
                }
                if p.flow.destination.port()==53{s.dns.fetch_add(1,Ordering::Relaxed);}
                if let Some(mut response)=p.udp_reply(&template,&payload){if address.flags&(1<<18)==0{address.inbound();}send(&s,&mut response,&mut address,true);}
            }
        }};
        if !completed {worker.abort();let _=worker.await;}return result;
    }
    let (mut control, relay) = socks(port, SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)), true)
        .await
        .map_err(|(_, error)| error)?;
    if !relay.ip().is_loopback() || relay.port() == 0 {
        return Err(std::io::Error::other("SOCKS UDP 入口必须为本机"));
    }
    let socket = UdpSocket::bind(SocketAddr::new(
        if relay.is_ipv4() {
            Ipv4Addr::LOCALHOST.into()
        } else {
            Ipv6Addr::LOCALHOST.into()
        },
        0,
    ))
    .await?;
    socket.connect(relay).await?;
    let mut buffer = vec![0; 65535];
    let mut control_byte = [0];
    let mut observed_reply = false;
    loop {
        tokio::select! {
            payload=rx.recv()=>{let Some(payload)=payload else{return Ok(());};
                if p.flow.destination.port()==53&&super::dns::Question::parse_query(&payload).is_some(){s.dns.fetch_add(1,Ordering::Relaxed);}
                socket.send(&super::udp::encode(p.flow.destination,&payload)?).await?;
            },
            length=socket.recv(&mut buffer)=>{let payload=super::udp::decode(&buffer[..length?],p.flow.destination)?;
                let is_valid = if owner.endpoint == 0 {
                    super::owner::lookup(p.flow) == Some(owner.identity.pid)
                        && s.owners.lock().unwrap().current(&owner)
                } else {
                    s.owners.lock().unwrap().current(&owner)
                };
                if !is_valid || !s.table.lock().unwrap().udp.get(&p.flow).is_some_and(|(g,_,_)| *g == generation) {
                    return Ok(());
                }
                if !observed_reply {
                    s.record_connection(evidence, p.flow, "socks_udp_reply", ConnectionOutcome::Relayed, None);
                    observed_reply = true;
                }
                if let Some(mut response)=p.udp_reply(&template,payload){if address.flags&(1<<18)==0{address.inbound();}send(&s,&mut response,&mut address,true);}
            },
            _=control.read(&mut control_byte)=>return Err(std::io::Error::other("SOCKS UDP 控制连接已断开")),
            _=tokio::time::sleep(Duration::from_secs(30))=>return Ok(()),
        }
    }
}

async fn dns_udp_relay(
    s: &Shared,
    p: Packet,
    template: Vec<u8>,
    address: &mut Address,
    dns_port: u16,
    query: &[u8],
    question: &super::dns::Question,
) -> std::io::Result<()> {
    tokio::time::timeout(Duration::from_secs(4), async {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        socket.connect((Ipv4Addr::LOCALHOST, dns_port)).await?;
        socket.send(query).await?;
        let mut buffer = vec![0u8; 65535];
        let n = socket.recv(&mut buffer).await?;
        let answer = &buffer[..n];
        if !question.matches_reply(answer) {
            return Err(std::io::Error::other("DNS 响应问题区不匹配"));
        }
        if let Some(mut response) = p.udp_reply(&template, answer) {
            if address.flags & (1 << 18) == 0 {
                address.inbound();
            }
            send(s, &mut response, address, true);
        }
        Ok(())
    })
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "本地 DNS 转发超时"))?
}

#[cfg(test)]
mod tests;
