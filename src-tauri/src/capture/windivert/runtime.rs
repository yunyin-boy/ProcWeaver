//! Scoped transparent TCP and SOCKS UDP relay. Two receive threads and a bounded
//! Tokio worker pool; no full process-table scan in the packet path.
use super::{
    driver::{Address, Device},
    ownership::{Event, Identity, Index},
    packet::{capture_bypass_destination, Flow, Packet},
    plan::Plan,
    preflight::VerifiedApi,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
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
        IpAddr::V6(_) => false,
    }
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
}
struct Route {
    external: Option<crate::external_proxy::captured::Context>,
    flow: Flow,
    token: u16,
    port: u16,
    touched: Mutex<Instant>,
    claimed: AtomicBool,
    finished: AtomicBool,
    cancel: tokio::sync::Notify,
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
        let before = old.port_for(&identity.path, identity.pid, identity.created_at);
        before.is_some() && before == next.port_for(&identity.path, identity.pid, identity.created_at)
            && flow.protocol == 17
    });
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
    tcp: AtomicU64,
    udp: AtomicU64,
    dns: AtomicU64,
    unknown: AtomicU64,
    failures: AtomicU64,
}

pub struct Engine {
    shared: Arc<Shared>,
    threads: Vec<JoinHandle<()>>,
    pool: Option<tokio::runtime::Runtime>,
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
        let loaded = VerifiedApi::load(components)?;
        let sockets = loaded
            .api
            .open("protocol == 6 or protocol == 17", 3, 1 | 4)?;
        if sockets.version().map_err(|_| "驱动版本读取失败")? != (2, 2) {
            return Err("WinDivert 共享驱动版本不兼容".into());
        }
        let mut managed_ports: std::collections::BTreeSet<u16> = plan.managed_endpoints.iter().map(|a| a.port()).collect();
        if let Some(p) = plan.mixed_port { managed_ports.insert(p); }
        if managed_ports.is_empty() { managed_ports.insert(7890); }
        let port_filter = managed_ports.iter().map(|p| format!("tcp.DstPort == {p}")).collect::<Vec<_>>().join(" or ");
        let default_filter = if !external && plan.targets.is_empty() && plan.instances.is_empty() && !plan.has_dns() {
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
            tcp: AtomicU64::new(0),
            udp: AtomicU64::new(0),
            dns: AtomicU64::new(0),
            unknown: AtomicU64::new(0),
            failures: AtomicU64::new(0),
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
        })
    }
    pub fn update(&self, plan: Plan) -> Result<(), String> {
        if self.shared.stop.load(Ordering::Acquire) {
            return Err("接管工作线程已停止".into());
        }
        plan.validate()?;
        if !self.shared.external {
            let old = self.shared.plan.read().unwrap();
            let mut table = self.shared.table.lock().unwrap();
            withdraw_routes(&mut table, &old, &plan);
        }
        *self.shared.plan.write().unwrap() = plan;
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
    #[link(name = "kernel32")]
    extern "system" {
        fn QueryPerformanceCounter(value: *mut i64) -> i32;
        fn QueryPerformanceFrequency(value: *mut i64) -> i32;
    }
    let id = Identity::inspect(event.pid)?;
    let (mut now, mut frequency) = (0i64, 0i64);
    if unsafe { QueryPerformanceCounter(&mut now) } == 0
        || unsafe { QueryPerformanceFrequency(&mut frequency) } == 0
        || frequency <= 0
        || event.timestamp > now
    {
        return None;
    }
    let wall = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos()
        / 100
        + 116444736000000000;
    let elapsed = (now - event.timestamp) as u128 * 10000000 / frequency as u128;
    let at = wall.checked_sub(elapsed)?;
    // Do not assign an old queued SOCKET event to a process born after it.
    (u128::from(id.created_at) <= at).then_some(id)
}
fn send(s: &Shared, data: &mut [u8], address: &mut Address, changed: bool) {
    if s.network.send(data, address, changed).is_err() {
        s.failures.fetch_add(1, Ordering::Relaxed);
    }
}
fn reflect(s: &Shared, p: &Packet, r: &Route, data: &mut [u8], a: &mut Address) {
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
    send(s, data, a, true);
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
                    *r.touched.lock().unwrap() = Instant::now();
                    reflect(&s, &packet, &r, data, &mut address);
                    continue;
                }
            }
            if !packet.syn {
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
        if s.table.lock().unwrap().bypass.contains_key(&flow) {
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
        // SOCKET 事件与系统连接表双轨异步判定：
        // 对于刚拉起的子进程或突发短命连接，在有界时间内进行微秒级退让和查表，
        // 彻底解决短命子进程第一条连接尚未写入 WFP 事件导致的“追不回首包”问题。
        if owner.is_none() && (packet.syn || flow.protocol == 17) {
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
            // 阶段 2: 若仍未就绪，进行有界微休眠重试（500us -> 1500us -> 3000us），兼顾低延迟与子进程首包捕获率
            if owner.is_none() && packet.syn {
                for wait_us in [500, 1500, 3000] {
                    std::thread::sleep(Duration::from_micros(wait_us));
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
                    // 每次微休眠后即时尝试 Windows 系统连接表反查
                    let pid = super::tcp_owner(flow.source, flow.destination);
                    if let Some(pid) = pid {
                        if let Some(identity) = Identity::inspect(pid) {
                            owner = Some(super::ownership::Owner {
                                endpoint: 0,
                                observed_at: address.timestamp,
                                identity,
                            });
                            break;
                        }
                    }
                }
            } else if owner.is_none() {
                // UDP 兜底即时反查
                if let Some(pid) = super::udp_owner(flow.source) {
                    if let Some(identity) = Identity::inspect(pid) {
                        owner = Some(super::ownership::Owner {
                            endpoint: 0,
                            observed_at: address.timestamp,
                            identity,
                        });
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
        let matched_port = if s.external {external.as_ref().map(|_|0)} else {owner
            .as_ref()
            .filter(|_| !is_excluded)
            .and_then(|o| {
                s.plan.read().unwrap().port_for(
                    &o.identity.path,
                    o.identity.pid,
                    o.identity.created_at,
                )
            })};
        let choice = if let Some(port) = matched_port {
            Some(port)
        } else {
            // A single available outlet is not evidence of process ownership.
            None
        };
        let Some(port) = choice else {
            if !is_excluded && !s.external && flow.protocol == 17 && flow.destination.port() == 53 {
                let payload = &data[packet.payload..];
                let matched_dns = super::dns::Question::parse_query(payload).and_then(|q| {
                    s.plan.read().unwrap().dns_port_for(&q.name).map(|dns_port| (q, dns_port))
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
            s.failures.fetch_add(1, Ordering::Relaxed);
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
                        s.failures.fetch_add(1, Ordering::Relaxed);
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
                send(&s, data, &mut address, true);
                s.tcp.fetch_add(1, Ordering::Relaxed);
                continue;
            }

            let mut t = s.table.lock().unwrap();
            if t.flows.len() >= 8192 {
                s.failures.fetch_add(1, Ordering::Relaxed);
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
                s.failures.fetch_add(1, Ordering::Relaxed);
                continue;
            };
            let route = Arc::new(Route {
                external,
                flow,
                token,
                port,
                touched: Mutex::new(Instant::now()),
                claimed: AtomicBool::new(false),
                finished: AtomicBool::new(false),
                cancel: tokio::sync::Notify::new(),
            });
            t.tokens.insert(token, route.clone());
            t.flows.insert(flow, route.clone());
            drop(t);
            reflect(&s, &packet, &route, data, &mut address);
        } else {
            let permit = match s.capacity.clone().try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    s.failures.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };
            let mut t = s.table.lock().unwrap();
            if t.udp.len() >= 1024 {
                s.failures.fetch_add(1, Ordering::Relaxed);
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
                if udp(
                    shared.clone(),
                    packet,
                    template,
                    address,
                    port,
                    rx,
                    generation,
                    owner,
                    external,
                )
                .await
                .is_err()
                {
                    shared.failures.fetch_add(1, Ordering::Relaxed);
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
        if route.claimed.swap(true, Ordering::AcqRel) {
            continue;
        }
        let Ok(permit) = s.capacity.clone().try_acquire_owned() else {
            route.finished.store(true, Ordering::Release);
            s.failures.fetch_add(1, Ordering::Relaxed);
            continue;
        };
        let shared = s.clone();
        s.worker.spawn(async move {
            let _permit = permit;
            shared.tcp.fetch_add(1, Ordering::Relaxed);
            let relay = async {
                if let Some(context)=route.external.clone() {
                    return crate::external_proxy::captured::tcp(context,stream,route.flow.destination).await.map_err(std::io::Error::other);
                }
                let (mut upstream, _) = socks(route.port, route.flow.destination, false).await?;
                tokio::io::copy_bidirectional(&mut stream, &mut upstream).await?;
                Ok::<(), std::io::Error>(())
            };
            let result = tokio::select! {
                result = relay => result,
                _ = route.cancel.notified() => Ok(()),
            };
            if result.is_err() {
                shared.failures.fetch_add(1, Ordering::Relaxed);
            }
            route.finished.store(true, Ordering::Release);
            *route.touched.lock().unwrap() = Instant::now();
        });
    }
}
async fn socks(
    port: u16,
    destination: SocketAddr,
    udp: bool,
) -> std::io::Result<(TcpStream, SocketAddr)> {
    tokio::time::timeout(Duration::from_secs(8), async {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await?;
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
            return Err(std::io::Error::other("SOCKS 认证失败"));
        }
        let mut request = vec![5, if udp { 3 } else { 1 }, 0];
        super::socks::encode(destination, &mut request);
        stream.write_all(&request).await?;
        let mut prefix = [0; 4];
        stream.read_exact(&mut prefix).await?;
        if prefix[..3] != [5, 0, 0] {
            return Err(std::io::Error::other("SOCKS 入口拒绝连接"));
        }
        let length = match prefix[3] {
            1 => 6,
            4 => 18,
            _ => return Err(std::io::Error::other("SOCKS 回应地址不支持")),
        };
        let mut data = vec![prefix[3]];
        data.resize(length + 1, 0);
        stream.read_exact(&mut data[1..]).await?;
        let (mut relay, _) =
            super::socks::decode(&data).ok_or_else(|| std::io::Error::other("SOCKS 回应无效"))?;
        if relay.ip().is_unspecified() {
            relay.set_ip(if relay.is_ipv4() {
                IpAddr::V4(Ipv4Addr::LOCALHOST)
            } else {
                IpAddr::V6(Ipv6Addr::LOCALHOST)
            });
        }
        Ok((stream, relay))
    })
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "SOCKS 入口超时"))?
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
    let (mut control, relay) =
        socks(port, SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)), true).await?;
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
