use super::*;
#[cfg(windows)]
#[test]
fn native_bundle_entries_switch_only_one_selector_and_rollback() {
    const NAME:&str="routing_overrides::bundle_runtime_tests::native_bundle_entries_switch_only_one_selector_and_rollback";
    const FLAG:&str="PROCWEAVER_BUNDLE_TEST";
    if std::env::var_os(FLAG).is_none() {
        let status=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact",NAME,"--nocapture"]).env(FLAG,"1").status().unwrap(); assert!(status.success()); return;
    }
    let dir=std::env::temp_dir().join(format!("procweaver-bundle-runtime-{}",std::process::id())); std::fs::create_dir_all(&dir).unwrap();
    crate::storage::initialize_test(dir.clone(),std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf());
    let free=||crate::storage::reserve_test_mixed_port().local_addr().unwrap().port();
    let preferences=settings::GeneralSettings{mixed_port:free(),controller_port:free(),..Default::default()};
    std::fs::write(dir.join("config/preferences.json"),serde_json::to_vec(&preferences).unwrap()).unwrap();
    std::fs::write(dir.join("config/local-rules.json"),r#"{"enabled":false,"providers":[]}"#).unwrap();
    let state=std::sync::Mutex::new(process::CoreState{child:None,mixed_port:preferences.mixed_port,controller_port:preferences.controller_port,active_core:None,active_core_path:None,core_mode:None,started_at:None});
    // Always reap our isolated core on assertions; never touch another running core.
    struct Cleanup<'a>(&'a std::sync::Mutex<process::CoreState>);
    impl Drop for Cleanup<'_>{fn drop(&mut self){if let Ok(mut state)=self.0.lock(){let _=process::stop_owned_child(&mut state);}}}
    let _cleanup=Cleanup(&state);
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        use tokio::io::{AsyncReadExt,AsyncWriteExt};
        let mut definitions=String::from("proxies:\n"); let mut servers=vec![];
        let wire_targets = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(String,String)>::new()));
        for name in ["node-a","node-b","node-c"] {
            let server=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap(); let port=server.local_addr().unwrap().port();
            definitions.push_str(&format!("- {{name: {name}, type: http, server: 127.0.0.1, port: {port}}}\n"));
            let wire = wire_targets.clone();
            servers.push(tokio::spawn(async move {loop {let (mut socket,_)=server.accept().await.unwrap();let wire=wire.clone();tokio::spawn(async move {
                let mut request=vec![];let mut byte=[0];
                while request.len()<8192 && !request.ends_with(b"\r\n\r\n") {if socket.read_exact(&mut byte).await.is_err(){return;}request.push(byte[0]);}
                if !request.starts_with(b"CONNECT "){return;}
                wire.lock().unwrap().push((name.into(),String::from_utf8_lossy(&request).lines().next().unwrap().into()));
                if socket.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.is_err(){return;}
                let mut probe=[0];if socket.read_exact(&mut probe).await.is_err() || probe!=[b'?']{return;}
                if socket.write_all(format!("{name}\n").as_bytes()).await.is_err(){return;}
                let (mut reader,mut writer)=socket.split();let _=tokio::io::copy(&mut reader,&mut writer).await;
            });}}));
        }
        let direct=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let fallback_port=direct.local_addr().unwrap().port();
        servers.push(tokio::spawn(async move {loop {let (mut socket,_)=direct.accept().await.unwrap();tokio::spawn(async move {
            let mut byte=[0];if socket.read_exact(&mut byte).await.is_ok() {let _=socket.write_all(b"direct\n").await;}
        });}}));
        // Public DIRECT fallback resolves locally; business names must never reach
        // this upstream. Profile hosts would run before every business outlet.
        let dns = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        definitions.push_str(&format!("dns:\n  enable: true\n  use-hosts: false\n  use-system-hosts: false\n  enhanced-mode: redir-host\n  nameserver: ['{}']\n", dns.local_addr().unwrap()));
        // Keep public destination sniffing active. Existing fixture traffic uses
        // 443; dedicated HTTP/TLS probes below use 80/8443 to avoid sniff delays.
        definitions.push_str("sniffer:\n  enable: true\n  force-dns-mapping: true\n  parse-pure-ip: true\n  override-destination: true\n  sniff:\n    HTTP: {ports: [80], override-destination: true}\n    TLS: {ports: [8443]}\n");
        let dns_names = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let seen = dns_names.clone();
        servers.push(tokio::spawn(async move { loop {
            let mut packet = [0; 2048]; let (len, source) = dns.recv_from(&mut packet).await.unwrap();
            if len < 17 { continue; }
            let mut pos = 12; let mut labels = vec![];
            while pos < len && packet[pos] != 0 {
                let size = packet[pos] as usize; pos += 1;
                if size > 63 || pos + size >= len { break; }
                labels.push(String::from_utf8_lossy(&packet[pos..pos+size]).into_owned()); pos += size;
            }
            if pos + 5 > len { continue; }
            seen.lock().unwrap().push(labels.join("."));
            let kind = u16::from_be_bytes([packet[pos+1],packet[pos+2]]);
            let mut response = packet[..pos+5].to_vec(); response[2] = 0x81; response[3] = 0x80;
            response[6] = 0; response[7] = u8::from(kind == 1); response[8..12].fill(0);
            if kind == 1 { response.extend_from_slice(&[0xc0,0x0c,0,1,0,1,0,0,0,1,0,4,127,0,0,1]); }
            let _ = dns.send_to(&response, source).await;
        }}));
        definitions.push_str("rules: ['DOMAIN,original.example.test,node-b', 'MATCH,PROXY']\n"); std::fs::write(dir.join("config/default.yaml"),&definitions).unwrap();
        process::start_core_transaction(Some("compatible".into()),&state).await.unwrap();
        let target=|name:&str|Target{profile_id:"default".into(),kind:"node".into(),name:name.into()};
        let mut config=Overrides{process_enabled:true,..Default::default()};
        for (id,node) in [("a","node-a"),("b","node-b"),("c","node-c")] {
            config.bundles.push(BundleRoute{id:id.into(),name:format!("包{id}"),main_exe:format!("fixture-{id}.exe"),enabled:true,main_target:Some(target(node)),dns_target:Some(target(node)),port:0,mode:"strict".into(),domains:vec![],fallback:"rules".into(),policy:None});
            config.process_rules.push(ProcessRule{id:format!("bundle-{id}-fixture-{id}.exe"),enabled:true,label:id.into(),match_kind:"name".into(),match_value:format!("fixture-{id}.exe"),action:"proxy".into(),target:Some(target(node)),include_descendants:false,rule_mode:Some("strict".into())});
        }
        let exe=std::env::current_exe().unwrap().file_name().unwrap().to_string_lossy().into_owned();
        for (id,main_exe,domains) in [("sandbox",exe,vec!["*.selected.example.test".into(),"exact.example.test".into()]),("empty","empty-fixture.exe".into(),vec![])] {
            config.bundles.push(BundleRoute{id:id.into(),name:id.into(),main_exe:main_exe.clone(),enabled:true,main_target:Some(target("node-a")),dns_target:Some(target("node-a")),port:0,mode:"sandbox".into(),domains,fallback:"rules".into(),policy:None});
            config.process_rules.push(ProcessRule{id:format!("bundle-{id}-main"),enabled:true,label:id.into(),match_kind:"name".into(),match_value:main_exe,action:"proxy".into(),target:Some(target("node-a")),include_descendants:false,rule_mode:Some("inherit".into())});
        }
        let saved=save(config,vec![]).await.unwrap();let ports:Vec<_>=saved.config.bundles.iter().map(|b|b.port).collect();
        async fn connect_to(port:u16,destination:&str,expected:&str)->tokio::net::TcpStream {
            use tokio::io::{AsyncReadExt,AsyncWriteExt};
            let mut socket=tokio::net::TcpStream::connect(("127.0.0.1",port)).await.unwrap();
            socket.write_all(format!("CONNECT {destination} HTTP/1.1\r\nHost: {destination}\r\n\r\n").as_bytes()).await.unwrap();
            let mut header=vec![];let mut byte=[0];while !header.ends_with(b"\r\n\r\n"){tokio::time::timeout(std::time::Duration::from_secs(5),socket.read_exact(&mut byte)).await.unwrap().unwrap();header.push(byte[0]);assert!(header.len()<8192);}
            assert!(String::from_utf8_lossy(&header).contains("200"));socket.write_all(b"?").await.unwrap();let mut line=vec![0;expected.len()+1];tokio::time::timeout(std::time::Duration::from_secs(5),socket.read_exact(&mut line)).await.unwrap().unwrap();assert_eq!(String::from_utf8_lossy(&line),format!("{expected}\n")); socket
        }
        async fn connect(port:u16,expected:&str)->tokio::net::TcpStream {connect_to(port,"192.0.2.123:443",expected).await}
        let control=reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(4)).build().unwrap();
        // CONNECT A must stay A even when HTTP Host/TLS SNI says B. Conversely,
        // public IP-only traffic must still be sniffed, proving we did not disable
        // the user's public setting to make the business probes pass.
        fn client_hello(host: &str) -> Vec<u8> {
            let mut sni = vec![0, 0, 0];
            sni.extend_from_slice(&(host.len() as u16).to_be_bytes()); sni.extend_from_slice(host.as_bytes());
            let list_len = (sni.len() - 2) as u16; sni[..2].copy_from_slice(&list_len.to_be_bytes());
            let mut extension = vec![0, 0]; extension.extend_from_slice(&(sni.len() as u16).to_be_bytes()); extension.extend(sni);
            let mut body = vec![3, 3]; body.extend([0; 32]); body.extend([0, 0, 2, 0, 0x2f, 1, 0]);
            body.extend_from_slice(&(extension.len() as u16).to_be_bytes()); body.extend(extension);
            let mut hello = vec![1, 0, (body.len() >> 8) as u8, body.len() as u8]; hello.extend(body);
            let mut record = vec![0x16, 3, 1]; record.extend_from_slice(&(hello.len() as u16).to_be_bytes()); record.extend(hello); record
        }
        let original_yaml: serde_yaml::Value = serde_yaml::from_str(&definitions).unwrap();
        let mut public_dns = crate::commands::dns::DnsSettings { use_hosts: false, use_system_hosts: false, enhanced_mode: "redir-host".into(),
            listener_mode: Some(crate::commands::dns::DnsListenerMode::Auto), listen: String::new(),
            nameserver: vec![original_yaml["dns"]["nameserver"][0].as_str().unwrap().into()], fallback: vec![], ..Default::default() };
        for override_enabled in [false, true] {
        public_dns.enable_override = override_enabled;
        std::fs::write(dir.join("config/dns-preferences.json"),serde_json::to_vec(&public_dns).unwrap()).unwrap();
        { let _lock=process::LIFECYCLE.lock().await; reapply(&saved.config).await.unwrap(); }
        control.put(format!("http://127.0.0.1:{}/proxies/PROXY",preferences.controller_port)).json(&serde_json::json!({"name":"node-b"})).send().await.unwrap().error_for_status().unwrap();
        for (socks, port, destination, payload, expected) in [
            (false, ports[0], "original-http.example.test:80", b"GET / HTTP/1.1\r\nHost: sniffed-http.example.test\r\n\r\n".to_vec(), "original-http.example.test:80"),
            (false, ports[0], "original-tls.example.test:8443", client_hello("sniffed-tls.example.test"), "original-tls.example.test:8443"),
            (true, ports[0], "original-socks-http.example.test:80", b"GET / HTTP/1.1\r\nHost: sniffed-http.example.test\r\n\r\n".to_vec(), "original-socks-http.example.test:80"),
            (true, ports[0], "original-socks-tls.example.test:8443", client_hello("sniffed-tls.example.test"), "original-socks-tls.example.test:8443"),
            (false, preferences.mixed_port, "192.0.2.123:80", b"GET / HTTP/1.1\r\nHost: public-http.example.test\r\n\r\n".to_vec(), "public-http.example.test:80"),
            (false, preferences.mixed_port, "192.0.2.123:8443", client_hello("public-tls.example.test"), "public-tls.example.test:8443"),
        ] {
            let before = wire_targets.lock().unwrap().len();
            let mut socket = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            if socks {
                socket.write_all(&[5,1,0]).await.unwrap(); let mut reply=[0;2];
                tokio::time::timeout(std::time::Duration::from_secs(5),socket.read_exact(&mut reply)).await.unwrap().unwrap(); assert_eq!(reply,[5,0]);
                let (host, port)=destination.rsplit_once(':').unwrap();
                let mut request=vec![5,1,0,3,host.len() as u8]; request.extend(host.as_bytes()); request.extend(port.parse::<u16>().unwrap().to_be_bytes());
                socket.write_all(&request).await.unwrap(); let mut header=[0;4];
                tokio::time::timeout(std::time::Duration::from_secs(5),socket.read_exact(&mut header)).await.unwrap().unwrap(); assert_eq!(&header[..2],&[5,0]);
                let remaining=match header[3] {1=>6,4=>18,3=>{let mut len=[0];tokio::time::timeout(std::time::Duration::from_secs(5),socket.read_exact(&mut len)).await.unwrap().unwrap();len[0] as usize+2},_=>panic!("SOCKS reply address invalid")};
                tokio::time::timeout(std::time::Duration::from_secs(5),socket.read_exact(&mut vec![0;remaining])).await.unwrap().unwrap();
            } else {
            socket.write_all(format!("CONNECT {destination} HTTP/1.1\r\nHost: {destination}\r\n\r\n").as_bytes()).await.unwrap();
            let mut header = vec![]; let mut byte = [0];
            while !header.ends_with(b"\r\n\r\n") { tokio::time::timeout(std::time::Duration::from_secs(5),socket.read_exact(&mut byte)).await.unwrap().unwrap(); header.push(byte[0]); assert!(header.len()<8192); }
            assert!(String::from_utf8_lossy(&header).contains("200"));
            }
            socket.write_all(&payload).await.unwrap();
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                loop { if wire_targets.lock().unwrap().len()>before { break; } tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
            }).await.expect("必须实际抵达模拟远端出口");
            let targets = wire_targets.lock().unwrap();
            assert_eq!(targets[before].0, if port==ports[0] {"node-a"} else {"node-b"});
            assert_eq!(targets[before].1, format!("CONNECT {expected} HTTP/1.1"));
        }
        }
        println!("公共 DNS 覆写开/关、HTTP/TLS 嗅探保持有效；业务 CONNECT/SOCKS 域名不被 HTTP Host/TLS SNI 替换：通过");
        for public in ["node-c","node-b"] {
            control.put(format!("http://127.0.0.1:{}/proxies/PROXY",preferences.controller_port)).json(&serde_json::json!({"name":public})).send().await.unwrap().error_for_status().unwrap();
            for port in [ports[3],preferences.mixed_port] {
                let _root=connect_to(port,"selected.example.test:443","node-a").await;
                let _sub=connect_to(port,"sub.selected.example.test:443","node-a").await;
                let _exact=connect_to(port,"exact.example.test:443","node-a").await;
                let _original=connect_to(port,"original.example.test:443","node-b").await;
                let _other=connect_to(port,"unmatched.example.test:443",public).await;
                let _not_exact=connect_to(port,"sub.exact.example.test:443",public).await;
                let _numeric=connect(port,public).await;
            }
            let _empty=connect_to(ports[4],"selected.example.test:443",public).await;
            let _strict=connect_to(ports[1],"unmatched.example.test:443","node-b").await;
        }
        // A different process using the common entry must not inherit this process's bundle.
        use std::os::windows::process::CommandExt;
        let script=format!(r#"$ErrorActionPreference='Stop'
$client=[Net.Sockets.TcpClient]::new('127.0.0.1',{})
try {{
  $stream=$client.GetStream();$stream.ReadTimeout=5000
  $request=[Text.Encoding]::ASCII.GetBytes("CONNECT selected.example.test:443 HTTP/1.1`r`nHost: selected.example.test:443`r`n`r`n")
  $stream.Write($request,0,$request.Length)
  $reader=[IO.StreamReader]::new($stream)
  $line=$reader.ReadLine();if($line -notmatch '200'){{throw 'CONNECT failed'}}
  while($reader.ReadLine() -ne ''){{}}
  $stream.WriteByte(63);$reader.ReadLine()
}} finally {{$client.Dispose()}}
"#,preferences.mixed_port);
        let output=std::process::Command::new("pwsh").args(["-NoProfile","-Command",&script]).creation_flags(0x08000000).output().unwrap();
        assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(),"node-b","未命中进程仍走原规则");
        let direct=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let direct_port=direct.local_addr().unwrap().port();
        let direct_server=tokio::spawn(async move {let(mut socket,_)=direct.accept().await.unwrap();let mut byte=[0];socket.read_exact(&mut byte).await.unwrap();socket.write_all(b"direct\n").await.unwrap();});
        let _direct=connect_to(ports[3],&format!("127.0.0.1:{direct_port}"),"direct").await;direct_server.await.unwrap();
        println!("沙盒真实分流：进程与域名共同命中、根/子域名、精确域名、未命中沿用原规则、空清单、强锁、原直连、公共节点切换和非匹配进程均通过");
        // Isolated switch transaction: mock only the OS registry write; the actual core reload and sockets are real.
        // The isolated public DNS upstream provides positive DIRECT probes; original-rule probes use non-private destinations
        // because the original plan intentionally routes private IPs directly regardless of the switch.
        let query=std::sync::atomic::AtomicUsize::new(0);
        let destination=||format!("fallback-{}.example.test:{fallback_port}",query.fetch_add(1,Ordering::SeqCst));
        let mut follow=saved.config.clone();follow.bundles[3].fallback="system".into();follow.bundles[4].fallback="system".into();
        follow.bundles[0].fallback="system".into(); // Strong mode ignores fallback.
        let saved=save(follow,vec![]).await.unwrap();
        for port in [ports[3],ports[4],preferences.mixed_port] {let _off=connect_to(port,&destination(),"direct").await;}
        let mut kept=connect(ports[1],"node-b").await;
        let before_switch=std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap();
        {
            let _lock=process::LIFECYCLE.lock().await;
            let failed=change_system_proxy(true,||Err("模拟系统写入失败".into())).await.unwrap_err();assert!(failed.contains("已恢复原路由"));
        }
        assert_eq!(std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap(),before_switch);
        let _rolled_back=connect_to(ports[3],&destination(),"direct").await;
        for enabled in [true,false,true] {
            {let _lock=process::LIFECYCLE.lock().await;assert_eq!(change_system_proxy(enabled,||Ok(enabled)).await.unwrap(),enabled);}
            assert_eq!(*SYSTEM_PROXY_ROUTED.lock().unwrap(),Some(enabled),"显式切换也更新最近成功的回退状态，避免外部立即改回时漏处理");
            // Public original selector changes must never replace the bundle's selected target.
            control.put(format!("http://127.0.0.1:{}/proxies/PROXY",preferences.controller_port)).json(&serde_json::json!({"name":"node-b"})).send().await.unwrap().error_for_status().unwrap();
            for port in [ports[3],preferences.mixed_port] {
                let _matched=connect_to(port,"selected.example.test:443","node-a").await;
                let address=if enabled {"unmatched.example.test:443".into()}else{destination()};
                let _fallback=connect_to(port,&address,if enabled {"node-b"}else{"direct"}).await;
            }
            let address=if enabled {"unmatched.example.test:443".into()}else{destination()};
            let _empty=connect_to(ports[4],&address,if enabled {"node-b"}else{"direct"}).await;
            let actual:serde_yaml::Value=serde_yaml::from_str(&std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap()).unwrap();
            let process_direct=format!("PROCESS-NAME,{},DIRECT",saved.config.bundles[3].main_exe);
            assert_eq!(actual["rules"].as_sequence().unwrap().iter().any(|r|r.as_str()==Some(&process_direct)),!enabled);
            let entry=&actual["sub-rules"][bundles::listener("sandbox")];
            assert_eq!(entry.as_sequence().unwrap().last().unwrap().as_str(),Some(if enabled {"MATCH,PROXY"}else{"MATCH,DIRECT"}));
            let _strong=connect(ports[0],"node-a").await;
            kept.write_all(b"alive").await.unwrap();let mut echo=[0;5];tokio::time::timeout(std::time::Duration::from_secs(3),kept.read_exact(&mut echo)).await.unwrap().unwrap();assert_eq!(&echo,b"alive");
        }
        // Observer reconciliation uses actual status; read errors and bypass changes keep routing.
        let proxy_status=|state:&str,bypass_changed:bool|crate::commands::sysproxy::SystemProxyStatus {
            state:state.into(),bypass_changed,message:String::new(),last_change:None,
        };
        {
            let _lock=process::LIFECYCLE.lock().await;
            reconcile_system_proxy(&proxy_status("enabled",false)).await.unwrap();
            let before=std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap();
            reconcile_system_proxy(&proxy_status("unknown",false)).await.unwrap();
            reconcile_system_proxy(&proxy_status("enabled",true)).await.unwrap();
            assert_eq!(std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap(),before);
        }
        let _retained=connect_to(ports[3],"unmatched.example.test:443","node-b").await;
        {let _lock=process::LIFECYCLE.lock().await;reconcile_system_proxy(&proxy_status("disabled",false)).await.unwrap();}
        let _off_after_observation=connect_to(ports[3],&destination(),"direct").await;
        {let _lock=process::LIFECYCLE.lock().await;reconcile_system_proxy(&proxy_status("enabled",false)).await.unwrap();}
        let _on_after_observation=connect_to(ports[3],"unmatched.example.test:443","node-b").await;
        println!("系统代理观察器：读取未知与绕过项变化不改变路由；实际关闭/开启才切换回退：通过");
        let mut direct_only=saved.config.clone();direct_only.bundles[3].fallback="direct".into();
        let saved=save(direct_only,vec![]).await.unwrap();
        {let _lock=process::LIFECYCLE.lock().await;change_system_proxy(true,||Ok(true)).await.unwrap();}
        for port in [ports[3],preferences.mixed_port] {let _always_direct=connect_to(port,&destination(),"direct").await;}
        let _empty_on=connect_to(ports[4],"unmatched.example.test:443","node-b").await;
        // Concurrent save and switch use the same lifecycle lock and cannot leave a half-applied plan.
        let concurrent=saved.config.clone();
        let (saved,switched)=tokio::join!(save(concurrent,vec![]),async {let _lock=process::LIFECYCLE.lock().await;change_system_proxy(false,||Ok(false)).await});
        let saved=saved.unwrap();assert_eq!(switched.unwrap(),false);
        let _concurrent=connect_to(ports[4],&destination(),"direct").await;
        // A core/API failure must occur before the OS write callback.
        let mut unreachable=preferences.clone();unreachable.controller_port=free();
        std::fs::write(dir.join("config/preferences.json"),serde_json::to_vec(&unreachable).unwrap()).unwrap();
        let called=std::sync::atomic::AtomicBool::new(false);
        {let _lock=process::LIFECYCLE.lock().await;assert!(change_system_proxy(true,||{called.store(true,Ordering::SeqCst);Ok(true)}).await.is_err());}
        assert!(!called.load(Ordering::SeqCst));
        std::fs::write(dir.join("config/preferences.json"),serde_json::to_vec(&preferences).unwrap()).unwrap();
        {let _lock=process::LIFECYCLE.lock().await;reapply(&saved.config).await.unwrap();}
        println!("沙盒回退真实验证：开=原规则/关=直连、命中出口不变、空清单、始终直连、强锁忽略开关、其他包长连接保持、系统写入失败回滚、并发保存、核心失败不写系统代理：通过");
        let _a=connect(ports[0],"node-a").await; let mut b=connect(ports[1],"node-b").await;let _c=connect(ports[2],"node-c").await;
        let before=std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap();
        let mut changed=saved.config.clone(); changed.bundles[0].main_target=Some(target("node-c"));changed.bundles[0].dns_target=Some(target("node-c"));changed.process_rules[0].target=Some(target("node-c"));
        let switched=save(changed,vec![]).await.unwrap();
        let after=std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap();
        assert_eq!(bundles::structural(&before).unwrap(),bundles::structural(&after).unwrap(),"单独换节点不能走配置重载");
        assert_eq!(ports,switched.config.bundles.iter().map(|b|b.port).collect::<Vec<_>>());
        let _new_a=connect(ports[0],"node-c").await; let _new_b=connect(ports[1],"node-b").await;
        b.write_all(b"keep-b-alive").await.unwrap();let mut echoed=[0;12];tokio::time::timeout(std::time::Duration::from_secs(3),b.read_exact(&mut echoed)).await.unwrap().unwrap();assert_eq!(&echoed,b"keep-b-alive");
        use std::os::windows::fs::OpenOptionsExt;
        let locked=std::fs::OpenOptions::new().read(true).share_mode(1).open(path()).unwrap();
        let mut failed=switched.config.clone();failed.bundles[0].main_target=Some(target("node-a"));failed.process_rules[0].target=Some(target("node-a"));
        assert!(save(failed,vec![]).await.is_err());drop(locked);
        assert_eq!(std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap(),after);let _restored=connect(ports[0],"node-c").await;
        process::stop_owned_child(&mut state.lock().unwrap()).unwrap();
        process::start_core_transaction(Some("compatible".into()),&state).await.unwrap();
        let _restarted=connect(ports[0],"node-c").await;let mut b=connect(ports[1],"node-b").await;
        let _restart_fallback=connect_to(ports[4],&destination(),"direct").await;
        for mode in ["global", "direct", "rule"] {
            tokio::time::timeout(std::time::Duration::from_secs(15), crate::commands::mihomo_api::set_mihomo_mode(mode.into()))
                .await.expect("公共模式切换不能等待自身生命周期锁").unwrap();
            let mode_view = crate::commands::mihomo_api::get_public_routing_mode().await.unwrap();
            assert_eq!(mode_view["mode"], mode); assert_eq!(mode_view["kernelMode"], "rule"); assert_eq!(mode_view["applied"], true);
            let _bundle_a = connect(ports[0], "node-c").await;
            let _bundle_b = connect(ports[1], "node-b").await;
            b.write_all(b"keep-b-alive").await.unwrap();
            let mut echoed=[0;12]; tokio::time::timeout(std::time::Duration::from_secs(3), b.read_exact(&mut echoed)).await.unwrap().unwrap();
            assert_eq!(&echoed,b"keep-b-alive", "公共切换不能中断业务长连接");
        }
        // Pausing preserves stored definitions, but withdraws all bundle inlets.
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::{OpenEventW, WaitForSingleObject}};
        let lease_name=crate::capture::user_mode::control::create(ports[0]).unwrap();
        let wide: Vec<u16>=std::ffi::OsStr::new(&lease_name).encode_wide().chain(Some(0)).collect();
        let observed_lease=unsafe { OpenEventW(0x00100000, 0, wide.as_ptr()) };
        assert!(!observed_lease.is_null());
        assert_eq!(unsafe { WaitForSingleObject(observed_lease, 0) }, 258);
        let before_pause=read().unwrap(); let mut paused=before_pause.clone(); paused.bundles_enabled=false;
        let paused=save(paused,vec![]).await.unwrap();
        assert_eq!(unsafe { WaitForSingleObject(observed_lease, 0) }, 0, "保存总关闭必须实际置位 Hook 撤销事件");
        let mut closed=[0;1];
        let closed=tokio::time::timeout(std::time::Duration::from_secs(2), b.read(&mut closed)).await;
        assert!(matches!(closed, Ok(Ok(0)) | Ok(Err(_))), "关闭总开关不能遗留旧业务长连接：{closed:?}");
        assert_eq!(serde_json::to_value(&before_pause.bundles).unwrap(),serde_json::to_value(&paused.config.bundles).unwrap());
        assert_eq!(before_pause.process_rules,paused.config.process_rules);
        assert!(tokio::net::TcpStream::connect(("127.0.0.1",ports[0])).await.is_err(), "关闭后不得保留业务代理入口");
        let paused_yaml: serde_yaml::Value = serde_yaml::from_str(&std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap()).unwrap();
        assert!(!paused_yaml["listeners"].as_sequence().into_iter().flatten().any(|v| v["name"].as_str().is_some_and(|s|s.starts_with("PW-") || s.starts_with("pw-wd-"))));
        assert!(!paused_yaml["proxy-groups"].as_sequence().into_iter().flatten().any(|v|v["name"].as_str().is_some_and(|s|s.starts_with("PW-"))));
        assert!(crate::commands::bundle_launch::get_bundle_entry_states(vec!["a".into()]).await.unwrap().is_empty());
        process::stop_owned_child(&mut state.lock().unwrap()).unwrap();
        process::start_core_transaction(Some("compatible".into()),&state).await.unwrap();
        assert!(tokio::net::TcpStream::connect(("127.0.0.1",ports[0])).await.is_err(), "重启不得重新开启已撤销入口");
        let mut resume=paused.config; resume.bundles_enabled=true; save(resume,vec![]).await.unwrap();
        assert_eq!(unsafe { WaitForSingleObject(observed_lease, 0) }, 0, "恢复业务不得复活旧 Hook 租约");
        unsafe { CloseHandle(observed_lease); }
        let _restored_bundle=connect(ports[0],"node-c").await;
        let queries = dns_names.lock().unwrap().clone();
        assert!(!queries.is_empty(), "公共 DIRECT 回退必须实际使用测试 DNS 上游");
        assert!(queries.iter().all(|name| name.starts_with("fallback-") && name.ends_with(".example.test")), "业务目标域名不得进入公共 DNS：{queries:?}");
        let targets = wire_targets.lock().unwrap().clone();
        let final_yaml: serde_yaml::Value = serde_yaml::from_str(&std::fs::read_to_string(dir.join("core_data/config.yaml")).unwrap()).unwrap();
        let original_yaml: serde_yaml::Value = serde_yaml::from_str(&definitions).unwrap();
        assert_eq!(final_yaml["sniffer"], original_yaml["sniffer"], "业务启停不得改写公共嗅探设置");
        assert_eq!(std::fs::read(dir.join("config/dns-preferences.json")).unwrap(), serde_json::to_vec(&public_dns).unwrap(), "业务启停不得改写公共 DNS 覆写设置");
        for domain in ["selected.example.test", "exact.example.test", "unmatched.example.test"] {
            assert!(targets.iter().any(|(_, line)| line.starts_with(&format!("CONNECT {domain}:443 "))), "绑定出口必须收到原始域名：{domain}");
        }
        process::stop_owned_child(&mut state.lock().unwrap()).unwrap();for server in servers {server.abort();}
        println!("三个真实入口独立分流；A 换节点无重载且 B 长连接保持；持久化失败恢复；核心重启恢复选择：通过");
    });
    std::fs::remove_dir_all(dir).unwrap();
}
