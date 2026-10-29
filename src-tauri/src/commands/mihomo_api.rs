use serde_json::Value;
mod monitor;
mod attribution;
pub(crate) fn invalidate_monitor_types() { monitor::invalidate(); }

fn is_proxy_connection(leaf: &str, kind: &str) -> bool {
    !leaf.is_empty() && !kind.is_empty()
        && !matches!(kind.to_ascii_lowercase().as_str(), "direct" | "reject" | "rejectdrop" | "pass" | "compatible")
        && !matches!(leaf, "DIRECT" | "REJECT" | "REJECT-DROP")
}

#[tauri::command]
pub async fn get_traffic_snapshot(state: tauri::State<'_, super::process::CoreStateMutex>, include_connections: Option<bool>) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        let mut sample: Value = crate::platform::android::call_async("stats", ()).await?;
        if include_connections.unwrap_or(false) {
            // Keep the native generation/counters when the connections page is opened.
            sample["details"] = controller_client().timeout(std::time::Duration::from_secs(3))
                .build().map_err(|_| "统计客户端初始化失败")?
                .get(format!("{}/connections", base_url()?)).send().await
                .map_err(|_| "读取连接详情失败")?.error_for_status()
                .map_err(|_| "核心拒绝连接详情请求")?.json().await.map_err(|_| "连接详情响应无效")?;
        }
        let _ = state;
        return Ok(sample);
    }
    #[cfg(not(target_os = "android"))]
    monitor::snapshot(&state, include_connections.unwrap_or(false)).await
}

/// 本地控制接口必须直连，避免系统代理形成回环或返回代理网关错误。
pub(crate) fn controller_client() -> reqwest::ClientBuilder {
    let client = reqwest::Client::builder().no_proxy();
    #[cfg(target_os = "android")]
    {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(secret) = crate::platform::android::controller_secret() {
            if let Ok(mut token) = reqwest::header::HeaderValue::from_str(&format!("Bearer {secret}")) {
                token.set_sensitive(true);
                headers.insert(reqwest::header::AUTHORIZATION, token);
            }
        }
        return client.default_headers(headers);
    }
    #[cfg(not(target_os = "android"))]
    client
}

#[cfg(test)]
mod tests {
    #[cfg(not(target_os = "android"))]
    #[test]
    fn stopped_core_lists_current_subscription_and_local_nodes_without_controller() {
        const NAME: &str = "commands::mihomo_api::tests::stopped_core_lists_current_subscription_and_local_nodes_without_controller";
        const FLAG: &str = "PROCWEAVER_OFFLINE_CATALOG_TEST";
        if std::env::var_os(FLAG).is_none() {
            assert!(std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", NAME, "--nocapture"]).env(FLAG, "1").status().unwrap().success());
            return;
        }
        use crate::commands::{process, profile};
        use serde_json::json;
        let root = std::env::temp_dir().join(format!("pw-offline-catalog-{}", std::process::id()));
        crate::storage::initialize_test(root.clone(), root.join("resources"));
        // This must work even with the controller disabled and no runtime config.
        std::fs::write(root.join("config/preferences.json"), br#"{"enableControllerPort":false}"#).unwrap();
        std::fs::write(root.join("config/local-nodes.json"), json!({"revision":1,"nodes":[{
            "id":"abc123","name":"Local fixture","config":{"type":"http","server":"local.invalid","port":8080,"password":"local-secret"}
        }]}).to_string()).unwrap();
        for id in ["one", "two"] {
            std::fs::write(root.join(format!("config/{id}.yaml")), format!(
                "proxies: [{{name: {id}, type: socks5, server: example.invalid, port: 1080, password: subscription-secret}}]\nproxy-groups: [{{name: PROXY, type: select, proxies: [{id}]}}]"
            )).unwrap();
        }
        let runtime = tokio::runtime::Runtime::new().unwrap();
        for selected in ["one", "two"] {
            let profiles: Vec<_> = ["one", "two"].iter().map(|id| profile::ProfileItem {
                id: (*id).into(), name: (*id).into(), file_path: format!("config/{id}.yaml"),
                is_selected: *id == selected, ..Default::default()
            }).collect();
            profile::write_profiles_index(&profiles).unwrap();
            let result = runtime.block_on(super::get_mihomo_proxies()).unwrap();
            assert_eq!(result["offline"], true);
            assert_eq!(result["catalogProfile"], selected);
            assert!(result["proxies"][selected].is_object());
            assert!(result["proxies"]["PW-L-abc123"].is_object());
            assert_eq!(result["proxies"].as_object().unwrap().len(), 3);
            assert_eq!(result["proxies"]["PROXY"]["all"], json!([selected, "PW-L-abc123"]));
            assert!(!result.to_string().contains("secret"));
            assert!(!result.to_string().contains(".invalid"));
            assert!(!process::ACTIVE.load(std::sync::atomic::Ordering::SeqCst));
        }
        std::fs::write(root.join("config/two.yaml"), "proxies: [").unwrap();
        assert!(runtime.block_on(super::get_mihomo_proxies()).is_err());
        assert!(!root.join("core_data/config.yaml").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn traffic_filter_uses_outbound_type_not_only_display_name() {
        assert!(super::is_proxy_connection("node", "Shadowsocks"));
        assert!(!super::is_proxy_connection("custom-direct", "Direct"));
        assert!(!super::is_proxy_connection("DIRECT", "Direct"));
        assert!(!super::is_proxy_connection("unknown", ""));
        assert!(!super::is_proxy_connection("drop", "RejectDrop"));
    }
    #[test]
    fn controller_bypasses_proxy_environment() {
        const FLAG: &str = "NETBOX_CONTROLLER_TEST_CHILD";
        if std::env::var_os(FLAG).is_none() {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "commands::mihomo_api::tests::controller_bypasses_proxy_environment"])
                .env(FLAG, "1")
                .env("HTTP_PROXY", "http://127.0.0.1:1")
                .env("HTTPS_PROXY", "http://127.0.0.1:1")
                .env("ALL_PROXY", "http://127.0.0.1:1")
                .env("NO_PROXY", "")
                .status().unwrap();
            assert!(status.success());
            return;
        }
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buffer = [0; 4096];
                stream.read(&mut buffer).await.unwrap();
                stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").await.unwrap();
            });
            let response = super::controller_client().timeout(std::time::Duration::from_secs(2))
                .build().unwrap().get(format!("http://{address}/proxies")).send().await.unwrap();
            assert!(response.status().is_success());
            server.await.unwrap();
        });
    }

    #[test]
    fn test_public_switch_connection_filtering() {
        use serde_json::json;

        let connections = json!([
            // 业务包连接（即使落地节点也是香港01，但策略链含 PW-，绝不关闭）
            {
                "id": "conn-bundle-1",
                "chains": ["PW-openai-main", "香港01"],
                "metadata": { "inboundName": "pw-openai-in" }
            },
            // 业务包独立 DNS 连接（绝不关闭）
            {
                "id": "conn-bundle-dns",
                "chains": ["PW-openai-dns", "DIRECT"],
                "metadata": { "inboundName": "pw-openai-dns-in" }
            },
            // 普通公共出口连接（使用旧节点 香港01，应被关闭）
            {
                "id": "conn-public-old",
                "chains": ["PROXY", "香港01"],
                "metadata": { "inboundName": "mixed-in" }
            },
            // 普通公共出口连接（已经在用新节点 日本02，无需关闭）
            {
                "id": "conn-public-new",
                "chains": ["PROXY", "日本02"],
                "metadata": { "inboundName": "mixed-in" }
            },
            // 独立工作分流组连接（例如 Telegram 走新加坡，不含 PROXY，不应被误关）
            {
                "id": "conn-telegram",
                "chains": ["Telegram", "新加坡01"],
                "metadata": { "inboundName": "mixed-in" }
            }
        ]);

        let target_groups = vec!["PROXY".to_string(), "GLOBAL".to_string()];
        let new_node = Some("日本02");

        let mut to_close_ids = Vec::new();
        for conn in connections.as_array().unwrap() {
            let id = conn.get("id").and_then(|id| id.as_str()).unwrap();
            let chains: Vec<&str> = conn
                .get("chains")
                .and_then(|c| c.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
                .unwrap_or_default();
            let metadata = conn.get("metadata");
            let inbound_name = metadata
                .and_then(|m| m.get("inboundName"))
                .and_then(|n| n.as_str())
                .unwrap_or("");

            let is_bundle = chains.iter().any(|c| c.starts_with("PW-") || c.starts_with("pw-"))
                || inbound_name.to_lowercase().starts_with("pw-");
            if is_bundle {
                continue;
            }

            let matches_public = chains.iter().any(|c| target_groups.iter().any(|tg| tg.eq_ignore_ascii_case(c)));
            if !matches_public {
                continue;
            }

            if let Some(target) = new_node {
                if chains.iter().any(|c| c.eq_ignore_ascii_case(target)) {
                    continue;
                }
            }

            to_close_ids.push(id);
        }

        assert_eq!(to_close_ids, vec!["conn-public-old"]);
    }
}

fn base_url() -> Result<String, String> {
    let settings = super::settings::get_general_settings()?;
    if !settings.enable_controller_port {
        return Err("API 外部控制端口已关闭，如需管理节点或测速请在设置中开启".into());
    }
    Ok(format!("http://127.0.0.1:{}", settings.controller_port))
}

fn url_encode(input: &str) -> String {
    let mut encoded = String::new();
    for b in input.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(b as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", b));
            }
        }
    }
    encoded
}

#[tauri::command]
pub async fn get_mihomo_proxies() -> Result<Value, String> {
    // Configuration remains manageable even with the core/controller stopped.
    #[cfg(not(target_os = "android"))]
    if !super::process::ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok(super::node_catalog::read()?.public());
    }
    #[cfg(target_os = "android")]
    let catalog = super::node_catalog::read()?.public();
    #[cfg(target_os = "android")]
    if !super::process::ACTIVE.load(std::sync::atomic::Ordering::SeqCst) { return Ok(catalog); }
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(format!("{}/proxies", base_url()?))
        .send()
        .await;
    #[cfg(target_os = "android")]
    if response.is_err() { return Ok(catalog); }
    let res = response.map_err(|e| format!("无法连接 Mihomo 控制端口: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Mihomo 返回错误状态: {}", res.status()));
    }

    let json: Value = res
        .json()
        .await
        .map_err(|e| format!("解析节点数据失败: {}", e))?;

    #[cfg(target_os = "android")]
    {
        let mut combined = catalog;
        if let Some(runtime) = json["proxies"].as_object() {
            for (name, proxy) in runtime {
                let key = combined["proxies"][name]["catalogKey"].clone();
                combined["proxies"][name] = proxy.clone();
                if !key.is_null() { combined["proxies"][name]["catalogKey"] = key; }
            }
        }
        combined["offline"] = false.into();
        return Ok(combined);
    }
    #[cfg(not(target_os = "android"))]
    Ok(json)
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct SwitchPublicNodeResult {
    pub success: bool,
    pub switched_groups: Vec<String>,
    pub protected_bundle_groups: Vec<String>,
    pub closed_connections_count: usize,
    pub message: String,
}

static PUBLIC_SWITCH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 精准关闭受影响公共组的连接，严格保护任何业务包连接 (PW-*)
async fn close_public_connections_for_groups(
    client: &reqwest::Client,
    base_url: &str,
    target_groups: &[String],
    new_node: Option<&str>,
) -> usize {
    let Ok(res) = client
        .get(format!("{}/connections", base_url))
        .send()
        .await
    else {
        return 0;
    };
    let Ok(json) = res.json::<serde_json::Value>().await else {
        return 0;
    };
    let Some(connections) = json.get("connections").and_then(|c| c.as_array()) else {
        return 0;
    };

    let mut to_close_ids = Vec::new();

    for conn in connections {
        let Some(id) = conn.get("id").and_then(|id| id.as_str()) else {
            continue;
        };
        let chains: Vec<&str> = conn
            .get("chains")
            .and_then(|c| c.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();

        let metadata = conn.get("metadata");
        let inbound_name = metadata
            .and_then(|m| m.get("inboundName"))
            .and_then(|n| n.as_str())
            .unwrap_or("");

        // 1. 绝对保护业务包：若策略链包含 PW- 或入站名称包含 pw-，坚决不关闭
        let is_bundle_connection = chains.iter().any(|c| c.starts_with("PW-") || c.starts_with("pw-"))
            || inbound_name.to_lowercase().starts_with("pw-");
        if is_bundle_connection {
            continue;
        }

        // 2. 必须包含被切换的公共策略组
        let matches_public_group = chains.iter().any(|c| {
            target_groups.iter().any(|tg| tg.eq_ignore_ascii_case(c))
        });
        if !matches_public_group {
            continue;
        }

        // 3. 若已在使用目标节点，无需中断
        if let Some(target) = new_node {
            if chains.iter().any(|c| c.eq_ignore_ascii_case(target)) {
                continue;
            }
        }

        to_close_ids.push(id.to_string());
    }

    let mut closed = 0;
    for id in to_close_ids {
        let url = format!("{}/connections/{}", base_url, url_encode(&id));
        if let Ok(resp) = client.delete(&url).send().await {
            if resp.status().is_success() {
                closed += 1;
            }
        }
    }
    closed
}

#[tauri::command]
pub async fn switch_public_node(node: String) -> Result<SwitchPublicNodeResult, String> {
    let _guard = PUBLIC_SWITCH_LOCK.lock().await;

    let client = controller_client()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;

    let base = base_url()?;

    // 1. 读取当前策略组快照
    let res = client
        .get(format!("{}/proxies", base))
        .send()
        .await
        .map_err(|e| format!("无法读取代理策略组: {}", e))?;
    let json: serde_json::Value = res.json().await.map_err(|e| format!("解析策略组失败: {}", e))?;
    let proxies = json.get("proxies").and_then(|p| p.as_object()).ok_or("无效的代理列表响应")?;

    // 记录切换前所有业务包专属组 (PW-*) 的当前选择
    let mut initial_bundle_now: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut public_groups: Vec<String> = Vec::new();

    for (name, val) in proxies {
        let is_hidden = val.get("hidden").and_then(|h| h.as_bool()).unwrap_or(false);
        let group_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let is_selector = group_type.eq_ignore_ascii_case("selector") || group_type.eq_ignore_ascii_case("select");
        let now_val = val.get("now").and_then(|n| n.as_str()).unwrap_or("").to_string();

        if name.starts_with("PW-") {
            initial_bundle_now.insert(name.clone(), now_val);
            continue;
        }

        if is_hidden {
            continue;
        }

        // 识别受管公共出口组
        let name_upper = name.to_uppercase();
        let is_public = name == "PROXY"
            || name == "GLOBAL"
            || name.contains("节点选择")
            || name_upper == "PROXIES"
            || name_upper == "DEFAULT";

        if is_public && is_selector {
            if let Some(all) = val.get("all").and_then(|a| a.as_array()) {
                if all.iter().any(|item| item.as_str() == Some(&node)) {
                    public_groups.push(name.clone());
                }
            }
        }
    }

    if public_groups.is_empty() {
        return Err(format!("未找到包含节点 [{node}] 的受管公共策略组，操作已取消以保护独立业务包。"));
    }

    // 2. 逐一执行公共组切换
    let mut switched_groups = Vec::new();
    for group_name in &public_groups {
        let url = format!("{}/proxies/{}", base, url_encode(group_name));
        let body = serde_json::json!({ "name": &node });
        let resp = client.put(url).json(&body).send().await.map_err(|e| format!("切换组 [{group_name}] 失败: {e}"))?;
        if !resp.status().is_success() {
            let err_body = resp.text().await.unwrap_or_default();
            return Err(format!("核心拒绝切换公共组 [{group_name}]: {err_body}"));
        }
        switched_groups.push(group_name.clone());
    }

    // 若公共组切了 PROXY 或包含节点选择的主组，且 GLOBAL 尚未包含在 switched_groups 中，则同步切换 GLOBAL
    #[cfg(not(target_os = "android"))]
    if switched_groups.iter().any(|g| g.contains("节点选择") || g.eq_ignore_ascii_case("proxy"))
        && !switched_groups.iter().any(|g| g.eq_ignore_ascii_case("global"))
    {
        if let Some(global_val) = proxies.get("GLOBAL") {
            if let Some(all) = global_val.get("all").and_then(|a| a.as_array()) {
                if all.iter().any(|item| item.as_str() == Some(&node)) {
                    let global_url = format!("{}/proxies/GLOBAL", base);
                    let global_body = serde_json::json!({ "name": &node });
                    if let Ok(resp) = client.put(global_url).json(&global_body).send().await {
                        if resp.status().is_success() {
                            switched_groups.push("GLOBAL".into());
                        }
                    }
                }
            }
        }
    }

    // 3. 回读核验：确认公共组确实切到了目标节点，且业务包组完好无损
    let verify_res = client.get(format!("{}/proxies", base)).send().await;
    let mut protected_bundle_groups = Vec::new();
    if let Ok(v_resp) = verify_res {
        if let Ok(v_json) = v_resp.json::<serde_json::Value>().await {
            if let Some(v_proxies) = v_json.get("proxies").and_then(|p| p.as_object()) {
                // 核验公共组
                for g in &switched_groups {
                    let actual_now = v_proxies.get(g).and_then(|v| v.get("now")).and_then(|n| n.as_str()).unwrap_or("");
                    if actual_now != node {
                        return Err(format!("回读核验失败：公共组 [{g}] 未成功切换至目标节点 [{node}]，当前为 [{actual_now}]"));
                    }
                }
                // 核验业务包组未被篡改
                for (b_name, b_initial_now) in &initial_bundle_now {
                    let actual_now = v_proxies.get(b_name).and_then(|v| v.get("now")).and_then(|n| n.as_str()).unwrap_or("");
                    if actual_now != b_initial_now {
                        return Err(format!("安全性故障：业务包专属策略组 [{b_name}] 被外部操作意外篡改（初始: {b_initial_now}, 当前: {actual_now}）"));
                    }
                    protected_bundle_groups.push(b_name.clone());
                }
            }
        }
    }

    // 4. 精准连接收尾：若开启了 auto_close_connections，只关闭受影响公共组的连接
    let mut closed_connections_count = 0;
    if super::settings::get_general_settings().map(|s| s.auto_close_connections).unwrap_or(true) {
        closed_connections_count = close_public_connections_for_groups(&client, &base, &switched_groups, Some(&node)).await;
    }

    Ok(SwitchPublicNodeResult {
        success: true,
        switched_groups,
        protected_bundle_groups,
        closed_connections_count,
        message: format!("已成功将公共出口切换至 [{node}]，受保护业务包组均保持独立绑定。"),
    })
}

#[tauri::command]
pub async fn switch_mihomo_proxy(group: String, proxy: String) -> Result<bool, String> {
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/proxies/{}", base_url()?, url_encode(&group));
    let body = serde_json::json!({ "name": &proxy });

    let res = client
        .put(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("切换节点请求失败: {}", e))?;

    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Mihomo 拒绝切换: {}", err_body));
    }

    // 若切换的是公共主策略组，同步将 GLOBAL 策略组切换至相同节点，确保全局模式下无缝生效
    #[cfg(not(target_os = "android"))]
    if group.to_lowercase().contains("节点选择") || group.eq_ignore_ascii_case("proxy") {
        let global_url = format!("{}/proxies/GLOBAL", base_url()?);
        let global_body = serde_json::json!({ "name": &proxy });
        let _ = client.put(global_url).json(&global_body).send().await;
    }

    // 切换节点后，根据设置决定是否断开旧连接
    // 严禁无差别全量 DELETE /connections！改用精准按 ID 关闭经过该组的连接，严格保护任何业务包专属连接
    if super::settings::get_general_settings().map(|s| s.auto_close_connections).unwrap_or(true) {
        let _ = close_public_connections_for_groups(&client, &base_url()?, &[group], Some(&proxy)).await;
    }

    Ok(true)
}

#[tauri::command]
pub async fn test_mihomo_delay(
    proxy: String,
    url: Option<String>,
    timeout: Option<u64>,
) -> Result<Option<u32>, String> {
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;

    // 默认采用 HTTPS 真实链路握手端点 (Cloudflare / Google)
    let test_url = url.unwrap_or_else(|| "https://cp.cloudflare.com/generate_204".into());
    let timeout_ms = timeout.unwrap_or(2000);

    let target = format!(
        "{}/proxies/{}/delay?url={}&timeout={}",
        base_url()?,
        url_encode(&proxy),
        url_encode(&test_url),
        timeout_ms
    );

    let res = client
        .get(target)
        .send()
        .await
        .map_err(|e| format!("测速请求失败: {}", e))?;

    if res.status().is_success() {
        let json: Value = res.json().await.map_err(|e| e.to_string())?;
        if let Some(delay) = json.get("delay").and_then(|d| d.as_u64()) {
            return Ok(Some(delay as u32));
        }
    }

    Ok(None)
}

#[tauri::command]
pub async fn get_mihomo_rules() -> Result<Value, String> {
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(format!("{}/rules", base_url()?))
        .send()
        .await
        .map_err(|e| format!("获取规则失败: {}", e))?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
pub async fn set_mihomo_mode(mode: String) -> Result<bool, String> {
    let _lifecycle = super::process::LIFECYCLE.lock().await;
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    // 规范化模式名称 (TitleCase)
    let standard_mode = match mode.to_lowercase().as_str() {
        "global" => "Global",
        "direct" => "Direct",
        _ => "Rule",
    };

    #[cfg(target_os = "android")]
    let _: Value = crate::platform::android::call_async("mode", serde_json::json!({"mode": standard_mode})).await?;
    #[cfg(not(target_os = "android"))]
    {
    let body = serde_json::json!({ "mode": standard_mode });
    let res = client
        .patch(format!("{}/configs", base_url()?))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("切换模式失败: {}", e))?;

    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Mihomo 拒绝切换模式: {}", err_body));
    }
    }

    // 模式持久化保存至首选项，重启后自动记忆恢复
    let _ = super::settings::update_persisted_run_mode(&standard_mode);

    // 切换模式后，根据设置断开所有旧的活动连接，使流量立刻按新模式路由
    if super::settings::get_general_settings().map(|s| s.auto_close_connections).unwrap_or(true) {
        let _ = client
            .delete(format!("{}/connections", base_url()?))
            .send()
            .await;
    }

    // 若切换为 Global 全局模式，确保 GLOBAL 策略组联动选中当前主出站节点
    if standard_mode == "Global" {
        if let Ok(proxies_res) = client.get(format!("{}/proxies", base_url()?)).send().await {
            if let Ok(json) = proxies_res.json::<Value>().await {
                if let Some(proxies_map) = json.get("proxies").and_then(|p| p.as_object()) {
                    let current_selected = proxies_map.iter().find_map(|(k, v)| {
                        let k_low = k.to_lowercase();
                        if k_low.contains("节点选择") || k_low == "proxy" || k_low == "select" || k_low == "proxies" {
                            v.get("now").and_then(|n| n.as_str()).map(|s| s.to_string())
                        } else {
                            None
                        }
                    });

                    if let Some(node_name) = current_selected {
                        let global_body = serde_json::json!({ "name": node_name });
                        let _ = client
                            .put(format!("{}/proxies/GLOBAL", base_url()?))
                            .json(&global_body)
                            .send()
                            .await;
                    }
                }
            }
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn get_mihomo_config() -> Result<Value, String> {
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(format!("{}/configs", base_url()?))
        .send()
        .await
        .map_err(|e| format!("获取配置失败: {}", e))?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
pub async fn get_mihomo_rule_providers() -> Result<Value, String> {
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(format!("{}/providers/rules", base_url()?))
        .send()
        .await
        .map_err(|e| format!("获取规则集失败: {}", e))?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
pub async fn update_mihomo_rule_provider(name: String) -> Result<bool, String> {
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .put(format!("{}/providers/rules/{}", base_url()?, url_encode(&name)))
        .send()
        .await
        .map_err(|e| format!("更新规则集失败: {}", e))?;

    Ok(res.status().is_success())
}

#[tauri::command]
pub async fn get_active_connections() -> Result<Value, String> {
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(format!("{}/connections", base_url()?))
        .send()
        .await
        .map_err(|e| format!("读取活动连接失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("核心拒绝请求: {}", e))?
        .json::<Value>()
        .await
        .map_err(|e| format!("活动连接数据解析失败: {}", e))?;

    let mut res = res;
    if let Some(conns) = res.get_mut("connections").and_then(|c| c.as_array_mut()) {
        #[cfg(windows)]
        let hook_tiers = super::windows_integration::read_hook_tiers();
        #[cfg(not(windows))]
        let hook_tiers: std::collections::HashMap<u32, (u32, String)> = std::collections::HashMap::new();

        for conn in conns {
            if let Some(metadata) = conn.get_mut("metadata").and_then(|m| m.as_object_mut()) {
                let proc_name = metadata.get("process").and_then(|p| p.as_str()).unwrap_or("");
                let mut tier_str = "Direct";
                for (_, (tier, name)) in &hook_tiers {
                    if !proc_name.is_empty() && (crate::platform::same_path(proc_name, name) || name.eq_ignore_ascii_case(proc_name)) {
                        tier_str = match *tier {
                            1 => "Detours",
                            2 => "IAT",
                            3 => "Direct",
                            _ => "Direct",
                        };
                        break;
                    }
                }
                metadata.insert("hookTier".into(), serde_json::Value::String(tier_str.into()));
            }
        }
    }

    Ok(res)
}

#[tauri::command]
pub async fn close_connection(id: String) -> Result<bool, String> {
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .delete(format!("{}/connections/{}", base_url()?, url_encode(&id)))
        .send()
        .await
        .map_err(|e| format!("关闭连接失败: {}", e))?;

    Ok(res.status().is_success())
}

#[tauri::command]
pub async fn close_all_connections() -> Result<bool, String> {
    let client = controller_client()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .delete(format!("{}/connections", base_url()?))
        .send()
        .await
        .map_err(|e| format!("关闭所有连接失败: {}", e))?;

    Ok(res.status().is_success())
}
