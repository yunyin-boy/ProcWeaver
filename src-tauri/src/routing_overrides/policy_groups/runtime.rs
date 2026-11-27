use super::{internal_name, path, read, render, valid_entry, yaml, RUNTIME_KEY};
use crate::commands::{mihomo_api, process, settings};
use reqwest::{Client, Url};
use serde_json::{Map, Value as Json};
use serde_yaml::Value;
use std::{collections::BTreeMap, fs, sync::atomic::Ordering, time::Duration};

type Choices = BTreeMap<String, String>;

fn controller() -> Result<(Client, String), String> {
    let client = mihomo_api::controller_client()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|_| "无法连接核心策略组")?;
    Ok((client, mihomo_api::base_url()?))
}

async fn snapshot(client: &Client, base: &str) -> Result<Map<String, Json>, String> {
    let raw: Json = client
        .get(format!("{base}/proxies"))
        .send()
        .await
        .map_err(|_| "读取核心策略组失败")?
        .error_for_status()
        .map_err(|_| "核心拒绝读取策略组")?
        .json()
        .await
        .map_err(|_| "核心策略组状态无效")?;
    raw.get("proxies")
        .and_then(Json::as_object)
        .cloned()
        .ok_or("核心策略组状态无效".into())
}

fn selector(name: &str, group: &Json) -> bool {
    !internal_name(name)
        && group["hidden"].as_bool() != Some(true)
        && group["type"].as_str().is_some_and(|kind| {
            kind.eq_ignore_ascii_case("selector") || kind.eq_ignore_ascii_case("select")
        })
}

fn contains(group: &Json, member: &str) -> bool {
    group["all"]
        .as_array()
        .is_some_and(|members| members.iter().any(|item| item.as_str() == Some(member)))
}

fn choices(proxies: &Map<String, Json>) -> Choices {
    proxies
        .iter()
        .filter_map(|(name, group)| {
            let member = group["now"].as_str()?;
            (selector(name, group)
                && valid_entry(name)
                && valid_entry(member)
                && contains(group, member))
            .then(|| (name.to_owned(), member.to_owned()))
        })
        .collect()
}

pub(crate) async fn current_choices() -> Result<Choices, String> {
    let (client, base) = controller()?;
    Ok(choices(&snapshot(&client, &base).await?))
}

pub(super) fn set_metadata(yaml: &mut Value, choices: &Choices) -> Result<(), String> {
    let map = yaml.as_mapping_mut().ok_or("策略组运行配置须为对象")?;
    let profile = map.entry("profile".into()).or_insert(Value::Null);
    if profile.is_null() {
        *profile = serde_yaml::Mapping::new().into();
    }
    let profile = profile.as_mapping_mut().ok_or("profile 须为对象")?;
    // The core's cache shares group names across profiles. The app restores its own scoped choices.
    profile.insert("store-selected".into(), false.into());
    map.insert(
        RUNTIME_KEY.into(),
        serde_yaml::to_value(choices).map_err(|_| "生成策略组选择记录失败")?,
    );
    Ok(())
}

pub(crate) fn has_metadata(yaml: &Value) -> bool {
    yaml.get(RUNTIME_KEY).is_some()
}

async fn choose(client: &Client, base: &str, group: &str, member: &str) -> Result<(), String> {
    let mut url = Url::parse(&format!("{base}/proxies/")).map_err(|_| "核心策略组地址无效")?;
    url.path_segments_mut()
        .map_err(|_| "核心策略组地址无效")?
        .pop_if_empty()
        .push(group);
    let response = client
        .put(url.clone())
        .json(&serde_json::json!({"name": member}))
        .send()
        .await
        .map_err(|_| "请求切换策略组失败")?;
    if !response.status().is_success() {
        return Err(format!("核心拒绝切换策略组（HTTP {}）", response.status()));
    }
    let value: Json = client
        .get(url)
        .send()
        .await
        .map_err(|_| "读取切换结果失败")?
        .error_for_status()
        .map_err(|_| "核心拒绝核验切换结果")?
        .json()
        .await
        .map_err(|_| "切换结果无效")?;
    if value["now"].as_str() != Some(member) {
        return Err(format!("核心未确认「{group}」已选择「{member}」"));
    }
    Ok(())
}

pub(crate) async fn restore_choices(saved: &Choices) -> Result<(), String> {
    if saved.is_empty() {
        return Ok(());
    }
    let (client, base) = controller()?;
    let proxies = snapshot(&client, &base).await?;
    for (name, wanted) in saved {
        let Some(group) = proxies.get(name) else {
            continue;
        };
        if selector(name, group) && contains(group, wanted) && group["now"].as_str() != Some(wanted)
        {
            choose(&client, &base, name, wanted).await?;
        }
    }
    Ok(())
}

pub(crate) async fn restore(raw: &str) -> Result<(), String> {
    let yaml = yaml(raw)?;
    if let Some(selected) = yaml.get(RUNTIME_KEY) {
        let saved = serde_yaml::from_value(selected.clone()).map_err(|_| "策略组选择记录无效")?;
        restore_choices(&saved).await?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn select_policy_group_member(
    group: String,
    member: String,
    profile_id: Option<String>,
) -> Result<String, String> {
    let _lock = process::LIFECYCLE.lock().await;
    crate::function_mode::require_full()?;
    if crate::shutdown::in_progress() {
        return Err("正在退出，暂不能切换策略组".into());
    }
    if !process::ACTIVE.load(Ordering::SeqCst) {
        return Err("请先启动核心".into());
    }
    let (active, _) = super::super::current_source();
    if profile_id
        .as_ref()
        .is_some_and(|expected| expected != &active)
    {
        return Err("当前方案已变更，请刷新后重试".into());
    }
    if !valid_entry(&group) || !valid_entry(&member) {
        return Err("策略组或成员名称无效".into());
    }
    let (client, base) = controller()?;
    let before = snapshot(&client, &base).await?;
    let current = before
        .get(&group)
        .filter(|value| selector(&group, value))
        .ok_or("当前组不是可手动切换的策略组")?;
    if !contains(current, &member) {
        return Err("该成员已不在当前策略组".into());
    }
    let previous = current["now"]
        .as_str()
        .filter(|name| contains(current, name))
        .ok_or("无法确认原选择")?;
    let mut store = read()?;
    let profile = store
        .profiles
        .entry(active)
        .or_insert_with(|| super::ProfileGroups {
            selections: choices(&before),
            ..Default::default()
        });
    profile.selections.insert(group.clone(), member.clone());
    let runtime_path = crate::storage::data_dir().join("core_data/config.yaml");
    let old = fs::read_to_string(&runtime_path).map_err(|_| "读取原运行配置失败")?;
    let mut next = yaml(&old)?;
    set_metadata(&mut next, &profile.selections)?;
    let next = render(&next)?;
    let selectors = super::super::bundles::rule_selectors(&yaml(&old)?)?;
    let bytes = store.advance()?;

    let change = previous != member;
    let mut runtime_written = false;
    let applied = async {
        if change {
            choose(&client, &base, &group, &member).await?;
            super::super::bundles::sync_rule_selectors(&client, &base, &selectors).await?;
        }
        crate::storage::replace_atomic(&runtime_path, next.as_bytes())?;
        runtime_written = true;
        crate::storage::replace_atomic(&path(), &bytes)
    }
    .await;
    if let Err(error) = applied {
        let mut failures = Vec::new();
        if runtime_written {
            if let Err(restore) = crate::storage::replace_atomic(&runtime_path, old.as_bytes()) {
                failures.push(restore);
            }
        }
        if change {
            let restored = async {
                let current = snapshot(&client, &base).await?;
                if current.get(&group).and_then(|item| item["now"].as_str()) != Some(previous) {
                    choose(&client, &base, &group, previous).await?;
                }
                super::super::bundles::sync_rule_selectors(&client, &base, &selectors).await
            }
            .await;
            if let Err(restore) = restored {
                failures.push(restore);
            }
        }
        return if failures.is_empty() {
            Err(format!("{error}，已保留原选择"))
        } else {
            Err(format!(
                "{error}。恢复原选择失败（{}）",
                failures.join("、")
            ))
        };
    }
    if change
        && settings::get_general_settings()
            .map(|value| value.auto_close_connections)
            .unwrap_or(true)
    {
        let _ =
            mihomo_api::close_public_connections_for_groups(&client, &base, &[group], None).await;
    }
    Ok(member)
}
