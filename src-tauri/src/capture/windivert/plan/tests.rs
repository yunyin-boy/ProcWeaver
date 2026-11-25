use super::*;
use crate::routing_overrides::model::{BundlePolicy, BundleRoute, ProcessRule, Target};

fn dns_bundle(id: &str, kind: &str, exit: &str) -> (BundleRoute, ProcessRule) {
    let target = Target { profile_id: "default".into(), kind: kind.into(), name: exit.into() };
    let bundle = BundleRoute {
        id: id.into(), name: id.into(), main_exe: format!("{id}.exe"), enabled: true,
        main_target: Some(target.clone()), dns_target: None, port: 34000,
        mode: "strict".into(), domains: vec![], fallback: "rules".into(), policy: Some(BundlePolicy::default()),
    };
    let rule = ProcessRule {
        id: format!("bundle-{id}-main"), enabled: true, label: id.into(),
        match_kind: "name".into(), match_value: bundle.main_exe.clone(), action: "proxy".into(),
        target: Some(target), include_descendants: true, rule_mode: Some("strict".into()),
    };
    (bundle, rule)
}

fn compose_dns_plan(raw: &str, config: &Overrides) -> (Plan, Value) {
    let (raw, mapped) = bundles::materialize(raw, config, "default").unwrap();
    let result: Value = serde_yaml::from_str(&compose(&raw, &mapped).unwrap()).unwrap();
    (serde_yaml::from_value(result[KEY].clone()).unwrap(), result)
}

#[test]
fn protected_dns_uses_existing_strict_entry_for_official_and_imported_bundle() {
    let raw = "rules: ['MATCH,DIRECT']\nproxies: [{name: ExitA, type: socks5, server: 192.0.2.1, port: 1080}]\n";
    let (official, main) = dns_bundle("antigravity-bundle", "node", "ExitA");
    let (imported, auxiliary) = dns_bundle("bundle-imported-example", "node", "ExitA");
    let mut config = Overrides {
        bundles: vec![official, imported], process_rules: vec![main, auxiliary],
        process_enabled: true, ..Default::default()
    };
    let (plan, yaml) = compose_dns_plan(raw, &config);
    assert_eq!(plan.owned_dns, ["bundle:antigravity-bundle", "bundle:bundle-imported-example"]);
    assert_eq!(yaml[KEY]["ownedDns"], serde_yaml::to_value(&plan.owned_dns).unwrap());
    assert!(plan.dns_port.is_none());
    assert_eq!(plan.entries.len(), 2);
    assert!(plan.uses_owned_dns("bundle:bundle-imported-example"));
    assert!(!plan.uses_owned_dns("rule:standalone-dns"));
    let entry = plan.destination_for(r"C:\Apps\bundle-imported-example.exe", 1, 1).unwrap();
    assert_eq!(entry, ("bundle:bundle-imported-example", Some(plan.targets[1].port)));

    config.bundles[0].policy.as_mut().unwrap().dns_mode = "system_native".into();
    config.bundles[1].policy.as_mut().unwrap().dns_mode = "fake_ip".into();
    let (other_modes, yaml) = compose_dns_plan(raw, &config);
    assert!(other_modes.owned_dns.is_empty());
    assert_eq!(other_modes.dns_mode("bundle:antigravity-bundle"), Some(DnsMode::SystemNative));
    assert_eq!(other_modes.dns_mode("bundle:bundle-imported-example"), Some(DnsMode::FakeIp));
    assert!(other_modes.uses_sandbox_dns("bundle:bundle-imported-example"));
    let scopes = yaml[bundles::SANDBOX_DNS].as_sequence().unwrap();
    assert!(scopes.iter().any(|scope| scope["mode"].as_str() == Some("system_native")));
    assert!(scopes.iter().any(|scope| scope["mode"].as_str() == Some("fake_ip")));
    assert_eq!(other_modes.entries, plan.entries);

    config.bundles[0].policy = Some(BundlePolicy::default());
    config.bundles[1].policy = Some(BundlePolicy::default());
    config.bundles[0].main_target.as_mut().unwrap().name = "missing-node".into();
    config.process_rules[1].action = "direct".into();
    config.process_rules[1].target = None;
    assert!(compose_dns_plan(raw, &config).0.owned_dns.is_empty());

    config.bundles[0].main_target.as_mut().unwrap().name = "DIRECT".into();
    config.process_rules[1].action = "reject".into();
    assert!(compose_dns_plan(raw, &config).0.owned_dns.is_empty());
}

#[test]
fn protected_dns_allows_explicit_proxy_groups_only_without_possible_direct_fallback() {
    let raw = r#"
rules: ['MATCH,DIRECT']
proxies:
  - { name: ExitA, type: socks5, server: 192.0.2.1, port: 1080 }
  - { name: ExitB, type: socks5, server: 192.0.2.2, port: 1080 }
  - { name: DirectAlias, type: direct }
proxy-groups:
  - { name: Verified, type: select, proxies: [ExitA, Relay] }
  - { name: Relay, type: relay, proxies: [ExitA, ExitB] }
  - { name: Direct, type: select, proxies: [ExitA, DIRECT] }
  - { name: Rejection, type: fallback, proxies: [ExitA, REJECT] }
  - { name: Alias, type: select, proxies: [ExitA, DirectAlias] }
  - { name: Compatibility, type: select, proxies: [COMPATIBLE] }
  - { name: CycleA, type: select, proxies: [CycleB] }
  - { name: CycleB, type: select, proxies: [Verified, CycleA] }
  - { name: Provider, type: select, proxies: [ExitA], use: [subscription] }
  - { name: Filtered, type: select, proxies: [ExitA], exclude-filter: ExitA }
"#;
    for (group, expected) in [
        ("Verified", true), ("Relay", true), ("Direct", false), ("Rejection", false),
        ("Alias", false), ("Compatibility", false), ("CycleA", false), ("CycleB", false),
        ("Provider", false), ("Filtered", false),
    ] {
        let (bundle, rule) = dns_bundle("browser", "group", group);
        let config = Overrides {
            bundles: vec![bundle], process_rules: vec![rule], process_enabled: true, ..Default::default()
        };
        assert_eq!(compose_dns_plan(raw, &config).0.uses_owned_dns("bundle:browser"), expected, "{group}");
    }
}

#[test]
fn protected_dns_plan_defaults_off_and_rejects_forged_owners() {
    let mut plan: Plan = serde_yaml::from_str("entries: []\ntargets: []\ninstances: []\ndnsPort: 45053\ndnsAll: true\n").unwrap();
    plan.validate().unwrap();
    assert!(!plan.uses_owned_dns("bundle:old"));
    assert_eq!(plan.dns_port_for("example.com"), Some(45053));
    assert!(serde_yaml::to_value(&plan).unwrap().get("ownedDns").is_none());

    plan.owned_dns.push("bundle:missing".into());
    assert!(plan.validate().is_err());
    let target = Entry {
        kind: "name".into(), value: "app.exe".into(), owner: "bundle:missing".into(),
        port: 61000, include_descendants: false,
    };
    plan.targets.push(target.clone());
    plan.entries.push(target);
    assert!(plan.validate().is_err());
    plan.entries[0].kind = "any".into();
    plan.entries[0].value = "*".into();
    plan.validate().unwrap();
    plan.owned_dns.push("bundle:missing".into());
    assert!(plan.validate().is_err());
}

#[test]
fn bundle_ipv6_policy_scope_and_managed_inlet_guard() {
    let mut raw: Value = serde_yaml::from_str("rules: ['MATCH,DIRECT']\nproxies: [{name: ExitA, type: socks5, server: 192.0.2.1, port: 1080}]\nlisteners: []\nsub-rules: {}\n").unwrap();
    let (mut strict, strict_rule) = dns_bundle("strict-app", "node", "ExitA");
    strict.policy = None; // older configuration uses the bundle policy defaults
    let (mut sandbox, sandbox_rule) = dns_bundle("sandbox-app", "node", "ExitA");
    sandbox.mode = "sandbox".into();
    let (mut opt_out, opt_out_rule) = dns_bundle("opt-out-app", "node", "ExitA");
    opt_out.policy.as_mut().unwrap().block_ipv6 = false;
    let (mut disabled, disabled_rule) = dns_bundle("disabled-app", "node", "ExitA");
    disabled.enabled = false;
    let manual = ProcessRule {
        id: "manual".into(), enabled: true, label: "manual".into(),
        match_kind: "name".into(), match_value: "manual.exe".into(), action: "direct".into(),
        target: None, include_descendants: false, rule_mode: None,
    };
    let mut config = Overrides {
        bundles: vec![strict, sandbox, opt_out, disabled],
        process_rules: vec![strict_rule, sandbox_rule, opt_out_rule, disabled_rule, manual],
        process_enabled: true,
        ..Default::default()
    };
    for (offset, bundle) in config.bundles.iter_mut().enumerate() { bundle.port += offset as u16; }
    bundles::add_listeners(&mut raw, &config, &Value::Null, &[Value::from("MATCH,DIRECT")]).unwrap();
    let raw = serde_yaml::to_string(&raw).unwrap();
    let (plan, yaml) = compose_dns_plan(&raw, &config);
    assert_eq!(plan.block_ipv6_owners, ["bundle:sandbox-app", "bundle:strict-app"]);
    assert_eq!(yaml[KEY]["blockIpv6Owners"], serde_yaml::to_value(&plan.block_ipv6_owners).unwrap());
    assert!(plan.uses_owned_dns("bundle:strict-app"));
    assert!(!plan.blocks_ipv6("bundle:opt-out-app"));
    assert!(!plan.blocks_ipv6("bundle:disabled-app"));
    assert!(!plan.blocks_ipv6("rule:manual"));
    for entry in &plan.entries {
        let name = format!("pw-wd-{}", entry.id().unwrap());
        let rules = yaml["sub-rules"][name.as_str()].as_sequence().unwrap();
        let guards: Vec<_> = rules.iter().filter_map(Value::as_str)
            .filter(|rule| PUBLIC_IPV6_REJECT_RULES.contains(rule)).collect();
        if plan.blocks_ipv6(&entry.owner) {
            assert_eq!(guards, PUBLIC_IPV6_REJECT_RULES, "{}", entry.owner);
            assert_eq!(rules.iter().take(guards.len()).filter_map(Value::as_str).collect::<Vec<_>>(), guards);
        } else {
            assert!(guards.is_empty(), "{}", entry.owner);
        }
    }
    for bundle in &config.bundles {
        let name = bundles::listener(&bundle.id);
        let rules = yaml["sub-rules"][name.as_str()].as_sequence().unwrap();
        let guards: Vec<_> = rules.iter().filter_map(Value::as_str)
            .filter(|rule| PUBLIC_IPV6_REJECT_RULES.contains(rule)).collect();
        assert_eq!(guards.len(), if plan.blocks_ipv6(&format!("bundle:{}", bundle.id)) { 3 } else { 0 });
    }
    assert!(!yaml["rules"].as_sequence().unwrap().iter().filter_map(Value::as_str)
        .any(|rule| PUBLIC_IPV6_REJECT_RULES.contains(&rule)));

    config.bundles[0].policy = Some(BundlePolicy { block_ipv6: false, ..Default::default() });
    let (changed, _) = compose_dns_plan(&raw, &config);
    assert_eq!(changed.entries, plan.entries);
    assert!(!changed.blocks_ipv6("bundle:strict-app"));
    assert!(changed.uses_owned_dns("bundle:strict-app"));
    config.bundles_enabled = false;
    assert!(compose_dns_plan(&raw, &config).0.block_ipv6_owners.is_empty());
}

#[test]
fn bundle_ipv6_policy_legacy_plan_and_invalid_owners() {
    let mut plan: Plan = serde_yaml::from_str("entries: []\ntargets: []\ninstances: []\n").unwrap();
    plan.validate().unwrap();
    assert!(!plan.blocks_ipv6("bundle:browser"));
    assert!(serde_yaml::to_value(&plan).unwrap().get("blockIpv6Owners").is_none());
    plan.block_ipv6_owners = vec!["bundle:browser".into()];
    assert!(plan.validate().is_err());

    let entry = Entry { kind: "any".into(), value: "*".into(), port: 61000,
        owner: "bundle:browser".into(), include_descendants: false };
    plan.entries.push(entry.clone());
    assert!(plan.validate().is_err());
    plan.targets.push(Entry { kind: "name".into(), value: "browser.exe".into(), ..entry });
    plan.validate().unwrap();
    plan.block_ipv6_owners.push("bundle:browser".into());
    assert!(plan.validate().is_err());
    plan.block_ipv6_owners = vec!["rule:browser".into()];
    plan.entries[0].owner = "rule:browser".into();
    plan.targets[0].owner = "rule:browser".into();
    assert!(plan.validate().is_err());
}

    #[test]
    fn composed_contexts_merge_case_variants_and_preserve_capture_targets() {
        use crate::routing_overrides::model::{Overrides, ProcessRule};
        let rule = |id: &str, kind: &str, value: &str| ProcessRule {
            id: id.into(), enabled: true, label: id.into(),
            match_kind: kind.into(), match_value: value.into(),
            action: "direct".into(), target: None, include_descendants: false, rule_mode: None,
        };
        let config = Overrides {
            process_enabled: true,
            process_rules: vec![rule("name", "name", "codex.EXE"), rule("path", "path", r"c:\apps\other.EXE")],
            ..Overrides::default()
        };
        let rules = ["PROCESS-NAME,CoDeX.exe,DIRECT", "AND,(PROCESS-NAME,codex.exe),(DOMAIN,example.invalid),REJECT",
            r"PROCESS-PATH,C:\Apps\Other.exe,DIRECT", r"PROCESS-PATH,c:\apps\other.exe,REJECT", "MATCH,REJECT"];
        let raw = serde_yaml::to_string(&serde_json::json!({"rules":rules})).unwrap();
        let result: Value = serde_yaml::from_str(&compose(&raw, &config).unwrap()).unwrap();
        assert_eq!(result["rules"], serde_yaml::to_value(rules).unwrap());
        let plan: Plan = serde_yaml::from_value(result[KEY].clone()).unwrap();
        assert_eq!(plan.entries.len(), 2);
        assert_eq!(plan.targets.len(), 2);
        let listeners = result["listeners"].as_sequence().unwrap();
        assert_eq!(listeners.len(), 4);
        assert_eq!(listeners.iter().filter(|l| l["name"].as_str().is_some_and(|n| !n.ends_with("-v6"))).count(), 2);
        assert_eq!(listeners.iter().filter(|l| l["name"].as_str().is_some_and(|n| n.ends_with("-v6"))).count(), 2);
        plan.validate().unwrap();
        for path in [r"C:\Apps\CODEX.exe", r"C:\APPS\OTHER.exe"] {
            assert!(plan.port_for(path, 1, 1).is_some());
        }
        assert!(plan.port_for(r"C:\Unrelated\other.exe", 1, 1).is_none());
        let lower = serde_yaml::to_string(&serde_json::json!({"rules":[
            "PROCESS-NAME,codex.exe,DIRECT", r"PROCESS-PATH,c:\apps\other.exe,DIRECT", "MATCH,REJECT"
        ]})).unwrap();
        let second: Value = serde_yaml::from_str(&compose(&lower, &config).unwrap()).unwrap();
        let second: Plan = serde_yaml::from_value(second[KEY].clone()).unwrap();
        for entry in &plan.entries {
            assert!(second.entries.iter().any(|other| other.kind == entry.kind
                && other.value.eq_ignore_ascii_case(&entry.value) && other.port == entry.port));
        }
    }

    #[test]
    fn inherited_restart_updates_revision_but_unrelated_process_does_not() {
        use crate::routing_overrides::{
            model::{Overrides, ProcessRule},
            tracker::{MonitorState, ProcessEntry, TrackingStatus},
        };
        let rule = |id: &str, kind: &str, value: &str| ProcessRule {
            id: id.into(),
            enabled: true,
            label: id.into(),
            match_kind: kind.into(),
            match_value: value.into(),
            action: "direct".into(),
            target: None,
            include_descendants: true,
            rule_mode: None,
        };
        let config = Overrides {
            process_enabled: true,
            process_rules: vec![rule("root", "name", "target.exe")],
            ..Overrides::default()
        };
        let child = ProcessEntry {
            identity: "7:99".into(),
            pid: 7,
            parent_pid: 1,
            name: "node.exe".into(),
            created_at: 99,
            executable_path: Some(r"C:\tools\node.exe".into()),
            parent_identity: Some("1:10".into()),
            ancestors: vec![("1:10".into(), r"C:\app\target.exe".into())],
        };
        let mut state = TrackingStatus {
            generation: 1,
            subscribed: true,
            ready: true,
            error: None,
            entries: vec![child],
            monitor_state: MonitorState::Current,
            unverified_names: vec![],
            derived: vec![rule("child", "path", r"C:\tools\node.exe")],
            conflicts: vec![],
            warnings: vec![],
        };
        let old = instance_revision(&config, &state);
        state.entries[0].pid = 8;
        state.entries[0].created_at = 100;
        state.entries[0].identity = "8:100".into();
        let restarted = instance_revision(&config, &state);
        assert_ne!(old, restarted);
        let mut other = state.entries[0].clone();
        other.pid = 9;
        other.created_at = 101;
        other.identity = "9:101".into();
        other.ancestors.clear();
        state.entries.push(other);
        assert_eq!(restarted, instance_revision(&config, &state));
        state.entries.remove(0);
        assert_eq!(instance_revision(&config, &state), "[]");
    }
    #[test]
    fn scope_does_not_capture_other_processes_and_paths_precede_names() {
        let entries = vec![
            Entry {
                owner: String::new(),
                kind: "name".into(),
                value: "chrome.exe".into(),
                port: 61001,
                include_descendants: false,
            },
            Entry {
                owner: String::new(),
                kind: "path".into(),
                value: r"C:\one\chrome.exe".into(),
                port: 61002,
                include_descendants: false,
            },
        ];
        let plan = Plan {
            targets: vec![entries[0].clone()],
            entries,
            instances: vec![],
            ..Plan::default()
        };
        plan.validate().unwrap();
        assert_eq!(plan.port_for(r"C:\one\chrome.exe", 1, 1), Some(61002));
        assert_eq!(plan.port_for(r"D:\two\chrome.exe", 1, 1), Some(61001));
        assert_eq!(plan.port_for(r"C:\node.exe", 1, 1), None);
    }
    #[test]
    fn inherited_shared_binary_is_scoped_to_one_process_incarnation() {
        let entry = Entry {
            owner: String::new(),
            kind: "path".into(),
            value: r"C:\node.exe".into(),
            port: 61001,
            include_descendants: false,
        };
        let plan = Plan {
            entries: vec![entry],
            targets: vec![],
            instances: vec![Instance {
                owner: String::new(),
                pid: 7,
                created_at: 99,
                path: r"C:\node.exe".into(),
            }],
            ..Plan::default()
        };
        assert_eq!(plan.port_for(r"C:\node.exe", 7, 99), Some(61001));
        assert_eq!(plan.port_for(r"C:\node.exe", 7, 100), None);
        assert_eq!(plan.port_for(r"C:\node.exe", 8, 99), None);
    }
    #[test]
    fn sniffer_override_destination_and_scoped_dns_port_matching_work() {
        use crate::routing_overrides::model::{DnsRule, Overrides, Target};
        let config = Overrides {
            dns_enabled: true,
            dns_rules: vec![DnsRule {
                id: "ag-dns".into(),
                enabled: true,
                domain_kind: "suffix".into(),
                domain: "googleapis.com".into(),
                resolver_url: "https://1.1.1.1/dns-query".into(),
                target: Target {
                    profile_id: "default".into(),
                    kind: "node".into(),
                    name: "VN".into(),
                },
            }],
            ..Overrides::default()
        };
        let raw = "dns:\n  enable: true\n  listen: 127.0.0.1:45053\nrules:\n  - MATCH,DIRECT\n";
        let result: Value = serde_yaml::from_str(&compose(raw, &config).unwrap()).unwrap();
        assert_eq!(result["sniffer"]["enable"], true);
        assert_eq!(result["sniffer"]["parse-pure-ip"], true);
        assert_eq!(result["sniffer"]["override-destination"], true);
        let plan: Plan = serde_yaml::from_value(result[KEY].clone()).unwrap();
        assert_eq!(plan.dns_port, Some(45053));
        assert_eq!(plan.dns_port_for("daily-cloudcode-pa.googleapis.com"), Some(45053));
        assert_eq!(plan.dns_port_for("googleapis.com"), Some(45053));
        assert_eq!(plan.dns_port_for("www.baidu.com"), None);
    }
