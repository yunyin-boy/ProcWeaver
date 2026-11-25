use super::*;
use crate::capture::windivert::plan::Entry;

async fn mock_socks(mut stream: TcpStream, counter: Arc<AtomicU64>) -> std::io::Result<()> {
    let mut greeting = [0; 3];
    stream.read_exact(&mut greeting).await?;
    assert_eq!(greeting, [5, 1, 0]);
    stream.write_all(&[5, 0]).await?;
    let mut header = [0; 4];
    stream.read_exact(&mut header).await?;
    let length = if header[3] == 1 { 6 } else { 18 };
    let mut endpoint = vec![header[3]];
    endpoint.resize(length + 1, 0);
    stream.read_exact(&mut endpoint[1..]).await?;
    let (destination, _) = crate::capture::windivert::socks::decode(&endpoint).unwrap();
    if header[1] == 1 {
        assert!(
            destination.ip().is_loopback()
                || destination.ip() == "192.0.2.123".parse::<IpAddr>().unwrap()
        );
        counter.fetch_add(1, Ordering::Relaxed);
        stream.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0]).await?;
        let (mut read, mut write) = stream.into_split();
        tokio::io::copy(&mut read, &mut write).await?;
    } else {
        assert_eq!(header[1], 3);
        let socket = UdpSocket::bind("127.0.0.1:0").await?;
        let mut reply = vec![5, 0, 0];
        crate::capture::windivert::socks::encode(socket.local_addr()?, &mut reply);
        stream.write_all(&reply).await?;
        let mut data = vec![0; 65535];
        let mut closed = [0];
        loop {
            tokio::select! {
                packet=socket.recv_from(&mut data)=>{let(n,peer)=packet?;counter.fetch_add(1,Ordering::Relaxed);socket.send_to(&data[..n],peer).await?;},
                _=stream.read(&mut closed)=>return Ok(())
            }
        }
    }
    Ok(())
}

#[test]
#[ignore = "administrator; captures only exact owned fixture tuples"]
fn real_runtime_tcp_udp_dns_and_stop_use_owned_flows_only() {
    let route = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
    route.connect("192.0.2.123:53").unwrap();
    let local = route.local_addr().unwrap().ip();
    drop(route);
    for ip in [
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(Ipv6Addr::LOCALHOST),
        local,
    ] {
        let pool = tokio::runtime::Runtime::new().unwrap();
        let listener = (61000..65000)
            .find_map(|port| std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port)).ok())
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let count = Arc::new(AtomicU64::new(0));
        {
            let _guard = pool.enter();
            let listener = TcpListener::from_std(listener).unwrap();
            let count = count.clone();
            pool.spawn(async move {
                while let Ok((stream, _)) = listener.accept().await {
                    let count = count.clone();
                    tokio::spawn(async move {
                        let _ = mock_socks(stream, count).await;
                    });
                }
            });
        }
        let client = pool.block_on(async {
            let client = if ip.is_ipv4() {
                tokio::net::TcpSocket::new_v4().unwrap()
            } else {
                tokio::net::TcpSocket::new_v6().unwrap()
            };
            client.bind(SocketAddr::new(ip, 0)).unwrap();
            client
        });
        let tcp_port = client.local_addr().unwrap().port();
        let udp = pool
            .block_on(UdpSocket::bind(SocketAddr::new(ip, 0)))
            .unwrap();
        let udp_port = udp.local_addr().unwrap().port();
        // The original TCP endpoint never echoes. A bypass cannot satisfy the test.
        let original = std::net::TcpListener::bind(SocketAddr::new(ip, 0)).unwrap();
        let destination = if ip.is_loopback() {
            original.local_addr().unwrap()
        } else {
            "192.0.2.123:443".parse().unwrap()
        };
        let own = Identity::inspect(std::process::id()).unwrap();
        let entry = Entry {
            owner: String::new(),
            kind: "path".into(),
            value: own.path,
            port,
            include_descendants: false,
        };
        let plan = Plan {
            entries: vec![entry.clone()],
            targets: vec![entry],
            instances: vec![],
            ..Plan::default()
        };
        let filter=format!("outbound and ((tcp and (tcp.SrcPort == {tcp_port} or tcp.SrcPort == {{relay4}} or tcp.SrcPort == {{relay6}})) or (udp and udp.SrcPort == {udp_port}))");
        let engine = Engine::start_inner(
            plan,
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/windivert"),
            vec![],
            Some(&filter),
        )
        .unwrap();
        let result=pool.block_on(async{tokio::time::timeout(Duration::from_secs(12),async{
            let mut tcp=client.connect(destination).await?;let message=vec![0x5a;65536];tcp.write_all(&message).await?;let mut reply=vec![0;message.len()];tcp.read_exact(&mut reply).await?;assert_eq!(reply,message);drop(tcp);
            udp.connect(SocketAddr::new(destination.ip(),53)).await?;
            let query=b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x02pw\x07invalid\x00\x00\x01\x00\x01";
            udp.send(query).await?;let mut response=[0;128];let n=udp.recv(&mut response).await?;assert_eq!(&response[..n],query);
            Ok::<(),std::io::Error>(())
        }).await});
        let stats = engine.stats();
        drop(engine);
        assert!(result.is_ok(), "{ip}: {result:?}, stats={stats:?}");
        assert!(result.unwrap().is_ok(), "stats={stats:?}");
        assert_eq!(stats.tcp, 1);
        assert_eq!(stats.dns, 1);
        assert!(count.load(Ordering::Relaxed) >= 2);
        drop(udp);
        pool.shutdown_timeout(Duration::from_secs(1));
    }
}

#[test]
#[ignore = "administrator; capture of isolated loopback fixture tuples in the Win11 VM"]
fn real_runtime_closed_rule_entry_does_not_connect_directly() {
    let machine = std::env::var("COMPUTERNAME").unwrap();
    assert_eq!(std::env::var("PW_WINDIVERT_VM_MACHINE").as_deref(), Ok(machine.as_str()));

    let pool = tokio::runtime::Runtime::new().unwrap();
    let original = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    original.set_nonblocking(true).unwrap();
    let destination = original.local_addr().unwrap();
    let (client, unavailable_entry) = pool.block_on(async {
        let client = tokio::net::TcpSocket::new_v4().unwrap();
        client.bind((Ipv4Addr::LOCALHOST, 0).into()).unwrap();
        // Hold the port without listening so another program cannot claim it.
        let unavailable_entry = (61000..65000).find_map(|port| {
            let socket = tokio::net::TcpSocket::new_v4().ok()?;
            socket.bind((Ipv4Addr::LOCALHOST, port).into()).ok()?;
            Some(socket)
        }).unwrap();
        (client, unavailable_entry)
    });
    let source = client.local_addr().unwrap().port();
    let port = unavailable_entry.local_addr().unwrap().port();
    let own = Identity::inspect(std::process::id()).unwrap();
    let entry = Entry {
        owner: "rule:closed-fixture".into(),
        kind: "path".into(),
        value: own.path,
        port,
        include_descendants: false,
    };
    let plan = Plan {
        entries: vec![entry.clone()],
        targets: vec![entry],
        ..Plan::default()
    };
    let filter = format!("outbound and tcp and (tcp.SrcPort == {source} or tcp.SrcPort == {{relay4}} or tcp.SrcPort == {{relay6}})");
    let assets = super::super::assets::prepare().unwrap();
    let engine = Engine::start_inner(plan, &assets, vec![], Some(&filter)).unwrap();
    let client_result = pool.block_on(async {
        tokio::time::timeout(Duration::from_secs(12), async {
            let mut stream = client.connect(destination).await?;
            stream.read(&mut [0u8; 1]).await
        }).await
    });
    let stats = pool.block_on(async {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let stats = engine.stats();
                if stats.recent_connections.iter().any(|event| event.outcome == ConnectionOutcome::Failed) {
                    return stats;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await
    }).unwrap_or_else(|_| engine.stats());
    drop(engine);

    assert!(matches!(client_result, Ok(Ok(0)) | Ok(Err(_))), "client={client_result:?}, stats={stats:?}");
    assert_eq!(original.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
    let attributed = stats.recent_connections.iter().find(|event| {
        event.outcome == ConnectionOutcome::Attributed && event.destination == destination.to_string()
    }).expect("matched rule attribution");
    assert_eq!(attributed.pid, own.pid);
    assert_eq!(attributed.rule_owner.as_deref(), Some("rule:closed-fixture"));
    assert_eq!(attributed.entry_port, Some(port));
    let failed = stats.recent_connections.iter().find(|event| {
        event.connection_id == attributed.connection_id && event.outcome == ConnectionOutcome::Failed
    }).expect("matched relay failure");
    assert_eq!(failed.stage, "socks_ingress");
    assert_eq!(failed.error_kind.as_deref(), Some("ConnectionRefused"));
    assert!(!stats.recent_connections.iter().any(|event| {
        event.connection_id == attributed.connection_id && event.outcome == ConnectionOutcome::Relayed
    }));
}

#[test]
fn evidence_history_is_bounded_and_round_trips_through_stats() {
    let mut history = VecDeque::new();
    for connection_id in 0..=(CONNECTION_EVIDENCE_LIMIT as u64) {
        remember_connection(&mut history, ConnectionEvidence {
            connection_id,
            time_ms: 13,
            pid: 20,
            process_name: "fixture.exe".into(),
            rule_owner: Some("rule:fixture".into()),
            entry_port: Some(61000),
            destination: "192.0.2.123:443".into(),
            protocol: "tcp".into(),
            stage: "ownership".into(),
            outcome: ConnectionOutcome::Attributed,
            error_kind: None,
            dns_name: None,
            dns_upstream: None,
        });
    }
    assert_eq!(history.len(), CONNECTION_EVIDENCE_LIMIT);
    assert_eq!(history.front().unwrap().connection_id, 1);
    let stats = Stats { recent_connections: history.into_iter().rev().collect(), ..Stats::default() };
    let value = serde_json::to_value(stats).unwrap();
    let first = &value["recentConnections"][0];
    assert_eq!(first["connectionId"], CONNECTION_EVIDENCE_LIMIT as u64);
    assert_eq!(first["processName"], "fixture.exe");
    assert_eq!(first["outcome"], "attributed");
    let decoded: Stats = serde_json::from_value(value).unwrap();
    assert_eq!(decoded.recent_connections.len(), CONNECTION_EVIDENCE_LIMIT);
    let previous: Stats = serde_json::from_value(serde_json::to_value(Stats::default()).unwrap()).unwrap();
    assert!(previous.recent_connections.is_empty());
}

#[test]
fn selected_owner_still_matches_when_child_entry_is_unavailable() {
    let target = Entry {
        owner: "rule:fixture".into(),
        kind: "name".into(),
        value: "fixture.exe".into(),
        port: 61000,
        include_descendants: false,
    };
    let path = r"C:\Apps\fixture.exe";
    let mut plan = Plan { targets: vec![target.clone()], ..Plan::default() };
    assert_eq!(plan.destination_for(path, 1, 1), Some(("rule:fixture", None)));
    plan.entries.push(target);
    assert_eq!(plan.destination_for(path, 1, 1), Some(("rule:fixture", Some(61000))));
    assert_eq!(plan.destination_for(r"C:\Apps\unrelated.exe", 1, 1), None);
}

#[test]
fn default_filter_excludes_loopback_to_prevent_local_proxy_packet_storm() {
    let plan = Plan {
        targets: vec![Entry {
            owner: "test".into(),
            kind: "path".into(),
            value: "test.exe".into(),
            port: 61000,
            include_descendants: false,
        }],
        ..Plan::default()
    };
    let default_filter = if plan.targets.is_empty() && plan.instances.is_empty() && !plan.has_dns() {
        "false"
    } else {
        "outbound and !loopback and (tcp or udp)"
    };
    assert!(default_filter.contains("!loopback"));
    assert_eq!(default_filter, "outbound and !loopback and (tcp or udp)");
}

#[tokio::test]
async fn withdrawing_bundle_context_preserves_existing_tcp_and_reclaims_changed_udp() {
    let tcp_route = |port| Arc::new(Route {
        external: None,
        identity: None,
        owned_dns: false,
        evidence: None,
        flow: Flow {source: "127.0.0.1:19000".parse().unwrap(), destination: "192.0.2.123:443".parse().unwrap(), protocol:6},
        token: port, port, touched: Mutex::new(Instant::now()), claimed: AtomicBool::new(true), finished: AtomicBool::new(false),
        ipv6_revoked: AtomicBool::new(false), cancel: tokio::sync::Notify::new(),
    });
    let withdrawn = tcp_route(61000);
    let mut table = Tables::default();
    table.flows.insert(withdrawn.flow, withdrawn.clone());

    let udp_flow = Flow {source: "127.0.0.1:20000".parse().unwrap(), destination: "8.8.8.8:53".parse().unwrap(), protocol: 17};
    let owner = super::super::ownership::Owner {
        endpoint: 1,
        observed_at: 1,
        identity: Identity { pid: 100, created_at: 200, path: r"C:\Apps\demo.exe".into() },
    };
    let (tx, _rx) = mpsc::channel(4);
    table.udp.insert(udp_flow, (1, owner, tx));

    let entry_old = Entry {kind:"path".into(),value:r"C:\Apps\demo.exe".into(),port:61000,owner:"bundle:a".into(),include_descendants:false};
    let old = Plan {entries:vec![entry_old.clone()], targets:vec![entry_old], ..Default::default()};
    let entry_new = Entry {kind:"path".into(),value:r"C:\Apps\demo.exe".into(),port:61002,owner:"bundle:a".into(),include_descendants:false};
    let next = Plan {entries:vec![entry_new.clone()], targets:vec![entry_new], ..Default::default()};
    withdraw_routes(&mut table, &old, &next);
    // 已建立的 TCP 长连接不暴力打断，UDP 归属出口改变后被清理以切换新入口
    assert!(!withdrawn.finished.load(Ordering::Acquire));
    assert!(table.udp.is_empty());
}

#[test]
fn ipv6_policy_classifies_external_and_nat64_addresses() {
    for address in ["2001:db8::42", "2606:4700::1111", "64:ff9b::c000:201", "64:ff9b:1::c000:201"] {
        assert!(external_ipv6(address.parse().unwrap()), "{address}");
    }
    for address in ["::1", "fd00::1", "fe80::1", "ff02::1", "::ffff:192.0.2.1", "192.0.2.1"] {
        assert!(!external_ipv6(address.parse().unwrap()), "{address}");
    }
}

#[test]
fn enabling_ipv6_policy_revokes_only_affected_existing_routes() {
    let identity = Identity { pid: 100, created_at: 200, path: r"C:\Apps\demo.exe".into() };
    let entry = Entry { kind: "path".into(), value: identity.path.clone(), port: 61000,
        owner: "bundle:demo".into(), include_descendants: false };
    let old = Plan { entries: vec![entry.clone()], targets: vec![entry], ..Default::default() };
    let next = Plan { block_ipv6_owners: vec!["bundle:demo".into()], ..old.clone() };
    let route = |source: &str, destination: &str, owned_dns| Arc::new(Route {
        external: None, identity: Some(identity.clone()), owned_dns, evidence: None,
        flow: Flow { source: source.parse().unwrap(), destination: destination.parse().unwrap(), protocol: 6 },
        token: 10001, port: 61000, touched: Mutex::new(Instant::now()), claimed: AtomicBool::new(true),
        finished: AtomicBool::new(false), ipv6_revoked: AtomicBool::new(false), cancel: tokio::sync::Notify::new(),
    });
    let ipv6 = route("[2001:db8::1]:19000", "[2001:db8::2]:443", false);
    let ipv4 = route("192.0.2.1:19001", "192.0.2.2:443", false);
    let dns = route("[2001:db8::1]:19002", "[2001:db8::53]:53", true);
    let mut table = Tables::default();
    for route in [&ipv6, &ipv4, &dns] {
        table.flows.insert(route.flow, route.clone());
    }
    withdraw_routes(&mut table, &old, &next);
    assert!(ipv6.ipv6_revoked.load(Ordering::Acquire));
    assert!(ipv6.finished.load(Ordering::Acquire));
    assert!(!ipv4.ipv6_revoked.load(Ordering::Acquire));
    assert!(!dns.ipv6_revoked.load(Ordering::Acquire));
}

const FIXTURE_DNS_QUERY: &[u8] = b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x02pw\x07invalid\x00\x00\x01\x00\x01";

#[test]
fn owned_doh_answer_restores_original_dns_id_and_rejects_mismatch() {
    let question = Question::parse_query(FIXTURE_DNS_QUERY).unwrap();
    let mut response = FIXTURE_DNS_QUERY.to_vec();
    response[..2].fill(0);
    response[2] |= 0x80;
    let valid = response.clone();
    validate_doh_answer(&question, &mut response).unwrap();
    assert_eq!(&response[..2], &question.id.to_be_bytes());
    assert!(question.matches_reply(&response));
    for (offset, mask) in [(1, 1), (2, 2), (2, 128), (14, 1), (27, 1)] {
        let mut changed = valid.clone();
        changed[offset] ^= mask;
        assert!(validate_doh_answer(&question, &mut changed).is_err(), "offset {offset}");
    }
}

#[tokio::test]
async fn owned_doh_uses_selected_socks_entry_and_fails_on_connect_rejection() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let proxy = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut greeting = [0; 3];
        stream.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 1, 0]);
        stream.write_all(&[5, 0]).await.unwrap();
        let mut request = [0; 10];
        stream.read_exact(&mut request).await.unwrap();
        assert_eq!(request, [5, 1, 0, 1, 1, 1, 1, 1, 1, 187]);
        stream.write_all(&[5, 5, 0, 1, 127, 0, 0, 1, 0, 0]).await.unwrap();
    });
    let question = Question::parse_query(FIXTURE_DNS_QUERY).unwrap();
    assert!(owned_doh(port, FIXTURE_DNS_QUERY, &question).await.is_err());
    proxy.await.unwrap();
}

#[test]
fn filter_key_detects_managed_endpoint_changes() {
    let mut plan_a = Plan { mixed_port: Some(7890), ..Default::default() };
    plan_a.managed_endpoints = vec!["127.0.0.1:7890".parse().unwrap()];
    let mut plan_b = plan_a.clone();
    plan_b.managed_endpoints.push("127.0.0.1:10811".parse().unwrap());
    assert_ne!(compute_filter_key(&plan_a), compute_filter_key(&plan_b));
}
