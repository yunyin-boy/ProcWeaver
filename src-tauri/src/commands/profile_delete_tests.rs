use super::{mihomo_api, process, profile, settings};
use crate::routing_overrides::{
    self as routing, bundles, foreign_targets,
    model::{BundleRoute, Overrides, ProcessRule, Target},
};
use std::{fs, os::windows::fs::OpenOptionsExt, path::PathBuf, sync::Mutex};

const PROFILE_ID: &str = "only-subscription";
const OUTLET_NAME: &str = "OnlySubscriptionNode";
const BUNDLE_ID: &str = "last-profile-test-bundle";
const EXE_NAME: &str = "last-profile-delete-fixture.exe";

struct CoreFixture {
    root: PathBuf,
    core: process::CoreStateMutex,
}

impl Drop for CoreFixture {
    fn drop(&mut self) {
        if let Ok(mut state) = self.core.lock() {
            let _ = process::stop_owned_child_ex(&mut state, true);
        }
        if self.root.canonicalize().ok().as_ref() == Some(&self.root) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

#[test]
fn deleting_the_last_subscription_rolls_back_on_commit_failure_then_holds_the_old_outlet() {
    const TEST: &str = concat!(
        "commands::profile_delete_tests::",
        "deleting_the_last_subscription_rolls_back_on_commit_failure_then_holds_the_old_outlet",
    );
    const CHILD: &str = "PROCWEAVER_LAST_PROFILE_DELETE_CHILD";
    if std::env::var_os(CHILD).is_none() {
        assert!(std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", TEST, "--nocapture"])
            .env(CHILD, "1")
            .status()
            .unwrap()
            .success());
        return;
    }

    let temp = std::env::temp_dir().canonicalize().unwrap();
    let root = temp.join(format!(
        "procweaver-last-profile-delete-{}",
        std::process::id()
    ));
    fs::create_dir(&root).unwrap();
    let resources = std::env::var_os("PROCWEAVER_RELEASE_FIXTURE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .to_path_buf()
        });
    crate::storage::initialize_test(root.clone(), resources);

    let mixed = crate::storage::reserve_test_mixed_port();
    let control = crate::storage::reserve_test_mixed_port();
    let entry = crate::storage::reserve_test_mixed_port();
    let prefs = settings::GeneralSettings {
        traffic_mode: "app_proxy".into(),
        auto_dns_guard_with_bundle: false,
        mixed_port: mixed.local_addr().unwrap().port(),
        controller_port: control.local_addr().unwrap().port(),
        ..Default::default()
    };
    let fixture = CoreFixture {
        root,
        core: Mutex::new(process::CoreState {
            child: None,
            mixed_port: prefs.mixed_port,
            controller_port: prefs.controller_port,
            active_core: None,
            active_core_path: None,
            core_mode: None,
            started_at: None,
        }),
    };
    let root = &fixture.root;
    fs::write(
        root.join("config/preferences.json"),
        serde_json::to_vec(&prefs).unwrap(),
    )
    .unwrap();
    fs::write(
        root.join("config/local-rules.json"),
        r#"{"enabled":false,"providers":[]}"#,
    )
    .unwrap();
    fs::write(
        root.join("config/default.yaml"),
        include_bytes!("../../defaults/default.yaml"),
    )
    .unwrap();

    let source_path = root
        .join("config/profiles")
        .join(format!("{PROFILE_ID}.yaml"));
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    let original_source = format!(
        "proxies: [{{name: {OUTLET_NAME}, type: http, server: 127.0.0.1, port: 9}}]\n\
         proxy-groups: [{{name: SubscriptionProxy, type: select, proxies: [{OUTLET_NAME}]}}]\n\
         rules: ['MATCH,SubscriptionProxy']\n"
    );
    fs::write(&source_path, &original_source).unwrap();
    profile::write_profiles_index(&[profile::ProfileItem {
        id: PROFILE_ID.into(),
        name: "最后一条测试订阅".into(),
        file_path: format!("config/profiles/{PROFILE_ID}.yaml"),
        is_selected: true,
        ..Default::default()
    }])
    .unwrap();
    let outlet = Target {
        profile_id: PROFILE_ID.into(),
        kind: "node".into(),
        name: OUTLET_NAME.into(),
    };
    let bundle = BundleRoute {
        id: BUNDLE_ID.into(),
        name: "严格测试规则包".into(),
        main_exe: EXE_NAME.into(),
        enabled: true,
        main_target: Some(outlet.clone()),
        dns_target: None,
        port: entry.local_addr().unwrap().port(),
        mode: "strict".into(),
        domains: vec![],
        fallback: "rules".into(),
        policy: None,
    };
    let task_rule = ProcessRule {
        id: format!("bundle-{BUNDLE_ID}-main"),
        enabled: true,
        label: "严格测试进程".into(),
        match_kind: "name".into(),
        match_value: EXE_NAME.into(),
        action: "proxy".into(),
        target: Some(outlet.clone()),
        include_descendants: false,
        rule_mode: Some("strict".into()),
    };
    let unrelated_rule = ProcessRule {
        id: "unrelated-direct".into(),
        label: "独立直连规则".into(),
        match_value: "unrelated-last-profile-fixture.exe".into(),
        action: "direct".into(),
        target: None,
        ..task_rule.clone()
    };
    let overrides = Overrides {
        process_enabled: true,
        retain_foreign_targets: true,
        bundles: vec![bundle],
        process_rules: vec![task_rule, unrelated_rule.clone()],
        ..Default::default()
    };
    let overrides_path = root.join("config/routing-overrides.json");
    let original_overrides = serde_json::to_vec(&overrides).unwrap();
    fs::write(&overrides_path, &original_overrides).unwrap();
    drop((mixed, control, entry));

    tokio::runtime::Runtime::new().unwrap().block_on(async {
        process::start_core_transaction(Some("compatible".into()), &fixture.core)
            .await
            .unwrap();
        let pid = fixture.core.lock().unwrap().child.as_ref().unwrap().id();
        let client = mihomo_api::controller_client().build().unwrap();
        let proxies_url = format!("http://127.0.0.1:{}/proxies", prefs.controller_port);
        let read_proxies = || async {
            client
                .get(&proxies_url)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap()
        };
        let selector = bundles::group(BUNDLE_ID, "main");
        let before = read_proxies().await;
        assert_eq!(before["proxies"][&selector]["now"], OUTLET_NAME);

        let index_path = profile::get_profiles_index_file();
        let original_index = fs::read(&index_path).unwrap();
        let index_lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&index_path)
            .unwrap();
        let failed = profile::delete_profile(PROFILE_ID.into()).await;
        drop(index_lock);
        let error = failed.expect_err("locked profiles index unexpectedly accepted deletion");
        assert!(error.contains("原子替换失败"), "{error}");
        assert_eq!(fs::read(&index_path).unwrap(), original_index);
        assert_eq!(fs::read(&overrides_path).unwrap(), original_overrides);
        assert_eq!(fs::read_to_string(&source_path).unwrap(), original_source);
        assert_eq!(routing::current_source().0, PROFILE_ID);
        let after_failure = read_proxies().await;
        assert_eq!(after_failure["proxies"][&selector]["now"], OUTLET_NAME);

        let source_lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&source_path)
            .unwrap();
        let failed = profile::delete_profile(PROFILE_ID.into()).await;
        drop(source_lock);
        let error = failed.expect_err("locked subscription YAML unexpectedly accepted deletion");
        assert!(error.contains("删除订阅文件失败"), "{error}");
        assert_eq!(fs::read(&index_path).unwrap(), original_index);
        assert_eq!(fs::read(&overrides_path).unwrap(), original_overrides);
        assert_eq!(fs::read_to_string(&source_path).unwrap(), original_source);
        assert_eq!(routing::current_source().0, PROFILE_ID);
        let after_failed_unlink = read_proxies().await;
        assert_eq!(
            after_failed_unlink["proxies"][&selector]["now"],
            OUTLET_NAME
        );

        assert!(profile::delete_profile(PROFILE_ID.into()).await.unwrap());
        assert!(profile::read_profiles_index().is_empty());
        assert!(!source_path.exists());
        assert_eq!(routing::current_source().0, "default");
        assert_eq!(
            fixture.core.lock().unwrap().child.as_ref().unwrap().id(),
            pid
        );
        let after_success = read_proxies().await;
        assert!(after_success["proxies"].get(OUTLET_NAME).is_none());
        let selected = &after_success["proxies"][&selector]["now"];
        if let Some(alias) = selected
            .as_str()
            .filter(|name| name.starts_with(foreign_targets::PREFIX))
        {
            assert_eq!(
                after_success["proxies"][alias]["all"],
                serde_json::json!(["REJECT"])
            );
        } else {
            assert_eq!(selected, "REJECT");
        }
        let saved = routing::read().unwrap();
        assert_eq!(saved.bundles[0].main_target, Some(outlet));
        assert!(saved.process_rules.contains(&unrelated_rule));
        assert!(routing::view()
            .unwrap()
            .unavailable_rules
            .contains(&format!("bundle:{BUNDLE_ID}")));
    });
}
