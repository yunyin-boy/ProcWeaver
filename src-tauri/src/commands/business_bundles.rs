use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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

fn bundle_store_path() -> PathBuf {
    crate::storage::data_dir().join("config/business-bundles.json")
}

/// 读取保存在后端的业务规则包实例定义
/// 若文件尚不存在（新环境或老版本升级），返回 None 供前端触发平滑无感迁移
#[tauri::command]
pub fn get_business_bundles() -> Result<Option<Vec<serde_json::Value>>, String> {
    let path = bundle_store_path();
    if !path.exists() {
        return Ok(None);
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("读取业务包存储失败: {e}"))?;
    let store: BusinessBundleStore = serde_json::from_slice(&bytes).map_err(|e| {
        format!("业务包配置损坏: {e}")
    })?;

    Ok(Some(store.instances))
}

/// 持久化业务规则包实例定义至后端明文文件 data/config/business-bundles.json
#[tauri::command]
pub fn save_business_bundles(instances: Vec<serde_json::Value>) -> Result<(), String> {
    let path = bundle_store_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let store = BusinessBundleStore {
        schema_version: 1,
        updated_at: now,
        instances,
    };

    let bytes = serde_json::to_vec_pretty(&store).map_err(|e| format!("序列化业务包失败: {e}"))?;
    crate::storage::replace_atomic(&path, &bytes).map_err(|e| format!("持久化业务包失败: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_business_bundle_store_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!("pw-bundle-test-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        crate::storage::initialize_test(temp_dir.clone(), temp_dir.clone());

        // 1. 初始状态文件不存在，返回 None
        assert_eq!(get_business_bundles().unwrap(), None);

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
        save_business_bundles(instances).unwrap();

        // 3. 再次读取，验证完整反序列化并且保全扩展未知字段
        let loaded = get_business_bundles().unwrap().expect("应成功读取");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0]["instanceId"], "inst-test");
        assert_eq!(loaded[0]["definition"]["packageName"], "测试套件");
        assert_eq!(loaded[0]["definition"]["customArbitraryField"]["foo"], "bar");

        // 清理临时目录
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
