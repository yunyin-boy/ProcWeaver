use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessBundleStore {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub instances: Vec<serde_json::Value>,
}

fn default_schema_version() -> u32 {
    1
}

pub(super) fn bundle_store_path() -> PathBuf {
    crate::storage::data_dir().join("config/business-bundles.json")
}

pub(super) fn read_store_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取业务包存储失败: {error}")),
    }
}

pub(super) fn parse_store(bytes: &[u8]) -> Result<BusinessBundleStore, String> {
    serde_json::from_slice(bytes).map_err(|error| format!("业务包配置损坏: {error}"))
}

pub(super) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn write_store(path: &Path, store: &mut BusinessBundleStore) -> Result<(), String> {
    store.updated_at = now_millis();
    let bytes = serde_json::to_vec_pretty(store).map_err(|_| "序列化业务包失败")?;
    crate::storage::replace_atomic(path, &bytes).map_err(|error| format!("持久化业务包失败: {error}"))
}

/// 读取保存在后端的业务规则包实例定义
/// 若文件尚不存在（新环境或老版本升级），返回 None 供前端触发平滑无感迁移
#[tauri::command]
pub async fn get_business_bundles() -> Result<Option<Vec<serde_json::Value>>, String> {
    let _lock = super::process::LIFECYCLE.lock().await;
    read_store_bytes(&bundle_store_path())?
        .map(|bytes| {
            let mut store = parse_store(&bytes)?;
            let unbound = crate::routing_overrides::unbound_existing_rule_bundles();
            for instance in &mut store.instances {
                if instance["instanceId"].as_str().is_some_and(|id| unbound.iter().any(|bundle| bundle == id)) {
                    instance["enabled"] = false.into();
                }
            }
            Ok(store.instances)
        })
        .transpose()
}

/// 持久化业务规则包实例定义至后端明文文件 data/config/business-bundles.json
#[tauri::command]
pub async fn save_business_bundles(instances: Vec<serde_json::Value>) -> Result<(), String> {
    let _lock = super::process::LIFECYCLE.lock().await;
    let path = bundle_store_path();
    #[cfg(windows)]
    if !crate::edition::PROCESS {
        let previous = read_store_bytes(&path)?.and_then(|bytes| parse_store(&bytes).ok());
        let saved = previous.as_ref().map_or(&[][..], |store| store.instances.as_slice());
        crate::routing_overrides::filters::validate_instance_changes(&instances, saved)?;
    }
    let mut store = BusinessBundleStore {
        schema_version: 1,
        updated_at: 0,
        instances,
    };
    write_store(&path, &mut store)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleRepositoryOrigin {
    repository_id: String,
    repository_name: String,
    repository_key: String,
    package_url: String,
}

/// Add a disabled instance with unbound outlet slots in one store transaction.
#[tauri::command]
pub async fn mount_repository_business_bundle(
    instance_id: String,
    definition: serde_json::Value,
    origin: BundleRepositoryOrigin,
    initial_instances: Option<Vec<serde_json::Value>>,
) -> Result<Vec<serde_json::Value>, String> {
    let package_id = definition["packageId"].as_str().filter(|id| {
        !id.is_empty() && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
    }).ok_or("规则包标识无效")?;
    if !instance_id.starts_with("repo-") || instance_id.len() > 80
        || !instance_id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        || !definition["packageName"].as_str().is_some_and(|name| !name.trim().is_empty())
        || !definition["processes"].as_array().is_some_and(|members| !members.is_empty() && members.len() <= 100)
    {
        return Err("规则包名称或进程定义无效".into());
    }
    let address = reqwest::Url::parse(&origin.package_url).map_err(|_| "GitHub 下载地址无效")?;
    if address.scheme() != "https" || address.host_str() != Some("raw.githubusercontent.com")
        || !address.username().is_empty() || address.password().is_some() || address.port().is_some()
        || origin.repository_key.is_empty() || origin.repository_key.len() > 2048
    {
        return Err("GitHub 仓库来源无效".into());
    }

    let _lock = super::process::LIFECYCLE.lock().await;
    let path = bundle_store_path();
    let mut store = match read_store_bytes(&path)? {
        Some(bytes) => parse_store(&bytes)?,
        None => BusinessBundleStore {
            schema_version: 1,
            updated_at: 0,
            instances: initial_instances.unwrap_or_default(),
        },
    };
    if store.instances.iter().any(|saved| {
        saved["definition"]["packageId"].as_str() == Some(package_id)
            && saved["repositoryOrigin"]["repositoryKey"].as_str() == Some(origin.repository_key.as_str())
    }) {
        return Ok(store.instances);
    }
    if store.instances.iter().any(|saved| saved["instanceId"].as_str() == Some(instance_id.as_str())) {
        return Err("规则包实例标识已存在，请重试".into());
    }

    let now = now_millis();
    let watcher_mode = if definition["mode"].as_str() == Some("sandbox") { "notify" } else { "auto" };
    let instance = serde_json::json!({
        "instanceId": instance_id,
        "definition": definition,
        "enabled": false,
        "slotBindings": { "main": null, "dns": "FOLLOW_MAIN" },
        "watcherMode": watcher_mode,
        "isModified": false,
        "createdAt": now,
        "updatedAt": now,
        "repositoryOrigin": origin,
    });
    #[cfg(windows)]
    crate::routing_overrides::filters::validate_instance_changes(std::slice::from_ref(&instance), &[])?;
    store.instances.push(instance);
    write_store(&path, &mut store)?;
    Ok(store.instances)
}

#[tauri::command]
pub async fn delete_business_bundle(
    instance_id: String,
    initial_instances: Option<Vec<serde_json::Value>>,
) -> Result<Vec<serde_json::Value>, String> {
    let _lock = super::process::LIFECYCLE.lock().await;
    let path = bundle_store_path();
    let previous = read_store_bytes(&path)?;
    let mut store = match &previous {
        Some(bytes) => parse_store(bytes)?,
        None => BusinessBundleStore {
            schema_version: 1,
            updated_at: 0,
            instances: initial_instances.ok_or("业务规则包状态已变化，请重试删除")?,
        },
    };
    let count = store.instances.len();
    store.instances.retain(|item| item["instanceId"].as_str() != Some(instance_id.as_str()));
    let removed = store.instances.len() != count;
    if removed {
        write_store(&path, &mut store)?;
    }

    // A previous attempt may already have removed the instance from disk.
    // Its compiled route can still be present and must be removed on retry.
    if let Err(error) = crate::routing_overrides::remove_bundle_locked(&instance_id).await {
        if removed {
            let restored = match previous {
                Some(bytes) => crate::storage::replace_atomic(&path, &bytes),
                None => std::fs::remove_file(&path).map_err(|error| error.to_string()),
            };
            restored.map_err(|restore| format!("{error}；恢复原业务包列表失败：{restore}"))?;
        }
        return Err(error);
    }
    Ok(store.instances)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_business_bundle_store_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!("pw-bundle-test-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        crate::storage::initialize_test(temp_dir.clone(), temp_dir.clone());

        // 1. 初始状态文件不存在，返回 None
        assert_eq!(get_business_bundles().await.unwrap(), None);

        // 2. 模拟保存高阶定义实例
        let instance = serde_json::json!({
            "instanceId": "inst-test",
            "enabled": true,
            "slotBindings": { "main": "JP 01", "dns": "FOLLOW_MAIN" },
            "definition": {
                "packageId": "test-pkg",
                "packageName": "测试套件",
                "packageVersion": "v1.0",
                "category": "dev",
                "mode": "strict",
                "icon": "🚀",
                "description": "测试套件描述",
                "slots": [],
                "processes": [
                    { "exe": "test.exe", "role": "main", "description": "主进程" }
                ],
                "customArbitraryField": { "foo": "bar" } // 扩展未知字段
            }
        });

        let instances = vec![instance.clone()];
        save_business_bundles(instances).await.unwrap();

        // 3. 再次读取，验证完整反序列化并且保全扩展未知字段
        let loaded = get_business_bundles().await.unwrap().expect("应成功读取");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0]["instanceId"], "inst-test");
        assert_eq!(loaded[0]["definition"]["packageName"], "测试套件");
        assert_eq!(loaded[0]["definition"]["customArbitraryField"]["foo"], "bar");

        // 清理临时目录
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[cfg(all(not(target_os = "android"), not(feature = "process-edition")))]
    #[tokio::test]
    async fn deleting_unbound_bundle_preserves_other_routes_and_rolls_back_on_failure() {
        use crate::routing_overrides::{self, model::{BundleRoute, DnsRule, Overrides, ProcessRule, Target}};
        use serde_json::json;
        const TEST: &str = "commands::business_bundles::tests::deleting_unbound_bundle_preserves_other_routes_and_rolls_back_on_failure";
        const CHILD: &str = "PROCWEAVER_BUNDLE_REMOVAL_FIXTURE";
        if std::env::var_os(CHILD).is_none() {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", TEST, "--nocapture"])
                .env(CHILD, "1")
                .status().unwrap();
            assert!(status.success());
            return;
        }
        let dir = std::env::temp_dir().join(format!("pw-test-bundle-removal-{}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        crate::storage::initialize_test(dir.clone(), dir.clone());

        let draft = json!({"instanceId":"draft","enabled":false,"slotTargets":{"main":null}});
        let keep = json!({"instanceId":"draft-next","enabled":true,
            "slotTargets":{"main":{"profileId":"old-import","kind":"node","name":"旧出口"}},
            "definition":{"packageName":"保留业务包","custom":{"retain":true}}});
        save_business_bundles(vec![draft.clone(), keep.clone()]).await.unwrap();
        let previous = std::fs::read(bundle_store_path()).unwrap();
        let target = Target { profile_id: "previous-subscription".into(), kind: "node".into(), name: "原出口".into() };
        let route = |id: &str, enabled: bool, port| BundleRoute {
            id: id.into(), name: id.into(), main_exe: format!("{id}.exe"), enabled, port,
            main_target: enabled.then(|| target.clone()), dns_target: None,
            mode: "strict".into(), domains: vec![], fallback: "rules".into(), policy: None,
        };
        let rule = |id: &str, name: &str, enabled| ProcessRule {
            id: id.into(), label: name.into(), enabled, match_kind: "name".into(), match_value: name.into(),
            action: "proxy".into(), target: Some(target.clone()), include_descendants: false, rule_mode: Some("strict".into()),
        };
        let dns = |id: &str, name: &str| DnsRule {
            id: id.into(), enabled: true, domain_kind: "exact".into(), domain: name.into(),
            resolver_url: "https://dns.example.test/query".into(), target: target.clone(),
        };
        let mut config = Overrides {
            revision: u64::MAX, bundles_enabled: false, ..Default::default()
        };
        config.bundles = vec![route("draft", false, 34000), route("draft-next", true, 34001)];
        config.process_rules = vec![
            rule("bundle-draft-worker", "draft.exe", false),
            rule("bundle-draft-next-worker", "next.exe", true),
            rule("manual", "manual.exe", true),
        ];
        config.dns_rules = vec![
            dns("bundle-dns-draft-lookup", "draft.example.test"),
            dns("bundle-dns-draft-next-lookup", "next.example.test"),
        ];
        let routing_path = dir.join("config/routing-overrides.json");
        std::fs::write(&routing_path, serde_json::to_vec(&config).unwrap()).unwrap();
        assert_eq!(delete_business_bundle("draft".into(), None).await.unwrap_err(), "规则修订号已耗尽");
        assert_eq!(std::fs::read(bundle_store_path()).unwrap(), previous);
        assert_eq!(routing_overrides::read().unwrap().bundles.len(), 2);

        config.revision = 3;
        std::fs::write(&routing_path, serde_json::to_vec(&config).unwrap()).unwrap();
        assert_eq!(delete_business_bundle("draft".into(), None).await.unwrap(), vec![keep.clone()]);
        let after = routing_overrides::read().unwrap();
        assert!(!after.bundles_enabled);
        assert_eq!(after.bundles.len(), 1);
        assert_eq!(after.bundles[0].port, 34001);
        assert_eq!(after.bundles[0].main_target.as_ref(), Some(&target));
        assert_eq!(&after.process_rules[..], &config.process_rules[1..]);
        assert_eq!(after.dns_rules.iter().map(|rule| rule.id.as_str()).collect::<Vec<_>>(), vec!["bundle-dns-draft-next-lookup"]);
        assert_eq!(delete_business_bundle("draft".into(), None).await.unwrap(), vec![keep]);
        assert_eq!(routing_overrides::read().unwrap().revision, after.revision);
        let _ = std::fs::remove_dir_all(dir);
    }
}
