use super::{fs, get_profiles_index_file, ProfileItem};
use crate::{routing_overrides as routing, storage};
use std::path::{Path, PathBuf};

struct Replacement {
    path: PathBuf,
    previous: Vec<u8>,
    next: Vec<u8>,
}

#[cfg(not(target_os = "android"))]
mod outlets {
    use super::*;
    use crate::commands::business_bundles;
    use routing::{bundles, composer, model::{Overrides, Target}};
    use serde_json::Value as Json;
    use serde_yaml::{Mapping, Value as Yaml};
    use std::collections::{HashMap, HashSet};

    type Renames = HashMap<String, String>;

    fn node_catalog(content: &[u8], id: &str) -> Option<(HashSet<String>, HashMap<Mapping, Vec<String>>)> {
        let raw = std::str::from_utf8(content).ok()?;
        let names: HashSet<_> = composer::targets(raw, id).ok()?.into_iter()
            .filter(|target| target.kind == "node")
            .map(|target| target.name)
            .collect();
        let yaml: Yaml = serde_yaml::from_slice(content).ok()?;
        let mut by_parameters: HashMap<Mapping, Vec<String>> = HashMap::new();
        for node in yaml["proxies"].as_sequence().into_iter().flatten() {
            let Some(name) = node["name"].as_str().filter(|name| names.contains(*name)) else { continue };
            // A chained dialer can change behind the same name. Only compare self-contained endpoints.
            if node.get("dialer-proxy").is_some()
                || !node["server"].as_str().is_some_and(|server| !server.is_empty())
                || node["port"].as_u64().is_none()
            { continue; }
            let Some(mut parameters) = node.as_mapping().cloned() else { continue };
            parameters.remove(Yaml::from("name"));
            by_parameters.entry(parameters).or_default().push(name.into());
        }
        Some((names, by_parameters))
    }

    fn renamed_nodes(old: &[u8], new: &[u8], id: &str) -> Renames {
        let Some((old_names, old_nodes)) = node_catalog(old, id) else { return Renames::new() };
        let Some((new_names, new_nodes)) = node_catalog(new, id) else { return Renames::new() };
        old_nodes.into_iter().filter_map(|(parameters, old)| {
            let [before] = old.as_slice() else { return None };
            let [after] = new_nodes.get(&parameters)?.as_slice() else { return None };
            // Never merge aliases, displace a surviving name, or reassign a reused name.
            (!new_names.contains(before) && !old_names.contains(after))
                .then(|| (before.clone(), after.clone()))
        }).collect()
    }

    fn rename_target(target: &mut Target, id: &str, renames: &Renames) -> bool {
        if target.profile_id != id || target.kind != "node" { return false; }
        let Some(name) = renames.get(&target.name) else { return false };
        target.name.clone_from(name);
        true
    }

    fn rename_routes(routes: &mut Overrides, id: &str, renames: &Renames) -> bool {
        let mut changed = false;
        for bundle in &mut routes.bundles {
            for target in [&mut bundle.main_target, &mut bundle.dns_target].into_iter().flatten() {
                changed |= rename_target(target, id, renames);
            }
        }
        for rule in &mut routes.process_rules {
            if bundles::owner(&rule.id, &routes.bundles).is_some() {
                if let Some(target) = &mut rule.target { changed |= rename_target(target, id, renames); }
            }
        }
        for rule in &mut routes.dns_rules {
            if bundles::dns_owner(&rule.id, &routes.bundles).is_some() {
                changed |= rename_target(&mut rule.target, id, renames);
            }
        }
        changed
    }

    fn rename_instance(instance: &mut Json, routes: &Overrides, profile: &ProfileItem, renames: &Renames) -> bool {
        if instance["backend"].as_str() == Some("external") { return false; }
        if ["slotTargets", "slotBindings"].into_iter().any(|key| !instance[key].is_null() && !instance[key].is_object()) {
            return false;
        }
        let route = instance["instanceId"].as_str().and_then(|id| routes.bundles.iter().find(|bundle| bundle.id == id));
        let mut changed = false;
        for (slot, compiled) in [("main", route.and_then(|bundle| bundle.main_target.as_ref())),
            ("dns", route.and_then(|bundle| bundle.dns_target.as_ref()))]
        {
            let stored = &instance["slotTargets"][slot];
            let binding = instance["slotBindings"][slot].as_str();
            if matches!(binding, Some("FOLLOW_MAIN" | "DIRECT" | "REJECT")) { continue; }
            let mut target = if let Ok(target) = serde_json::from_value::<Target>(stored.clone()) {
                target
            } else {
                // Name-only instances followed the active subscription. A compiled target,
                // when present, is the authoritative source for that older record.
                if stored.get("profileId").is_some_and(|value| !value.is_null())
                    || stored.get("kind").and_then(Json::as_str).is_some_and(|kind| kind != "node")
                { continue; }
                let Some(name) = stored["name"].as_str().or(binding) else { continue };
                if let Some(target) = compiled {
                    if target.name != name { continue; }
                    target.clone()
                } else if profile.is_selected {
                    Target { profile_id: profile.id.clone(), kind: "node".into(), name: name.into() }
                } else {
                    continue;
                }
            };
            if rename_target(&mut target, &profile.id, renames) {
                instance["slotBindings"][slot] = target.name.clone().into();
                instance["slotTargets"][slot] = serde_json::json!(target);
                changed = true;
            }
        }
        changed
    }

    pub(super) fn plan(profile: &ProfileItem, old: &[u8], new: &[u8]) -> Result<(Vec<Replacement>, bool), String> {
        let renames = renamed_nodes(old, new, &profile.id);
        if renames.is_empty() { return Ok((Vec::new(), false)); }
        let routing_path = routing::path();
        let routing_bytes = match fs::read(&routing_path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(format!("读取旧分流配置失败，{error}")),
        };
        let before: Overrides = routing_bytes.as_deref().map(serde_json::from_slice).transpose()
            .map_err(|_| "分流配置损坏，无法迁移原出口")?.unwrap_or_default();
        let mut writes = Vec::new();
        let bundles_path = business_bundles::bundle_store_path();
        if let Some(previous) = business_bundles::read_store_bytes(&bundles_path)? {
            let mut store = business_bundles::parse_store(&previous)?;
            let now = business_bundles::now_millis();
            let mut changed = false;
            for instance in &mut store.instances {
                if rename_instance(instance, &before, profile, &renames) {
                    let updated = instance["updatedAt"].as_u64().unwrap_or_default();
                    instance["updatedAt"] = now.max(updated.saturating_add(1)).into();
                    changed = true;
                }
            }
            if changed {
                store.updated_at = now;
                let next = serde_json::to_vec_pretty(&store).map_err(|_| "序列化迁移后的业务包失败")?;
                writes.push(Replacement { path: bundles_path, previous, next });
            }
        }
        let mut after = before;
        let routes_changed = rename_routes(&mut after, &profile.id, &renames);
        if let Some(previous) = routing_bytes.filter(|_| routes_changed) {
            after.revision = after.revision.checked_add(1).ok_or("分流修订号已耗尽")?;
            let next = serde_json::to_vec_pretty(&after).map_err(|_| "序列化迁移后的分流规则失败")?;
            writes.push(Replacement { path: routing_path, previous, next });
        }
        Ok((writes, routes_changed))
    }
}

/// Called under PROFILE_WRITE. Stage binding and subscription changes from the
/// old files, then publish them together with the corresponding runtime plan.
pub(super) async fn commit(profiles: &[ProfileItem], profile: &ProfileItem, path: &Path, content: &str) -> Result<(), String> {
    let previous = fs::read(path).map_err(|error| format!("读取旧订阅失败，{error}"))?;
    let mut runtime = super::super::profile_switch::runtime_source_for_change(profile)?;
    #[cfg(not(target_os = "android"))]
    let (mut writes, routes_changed) = outlets::plan(profile, &previous, content.as_bytes())?;
    #[cfg(target_os = "android")]
    let (mut writes, routes_changed) = (Vec::new(), false);
    if runtime.is_none() && routes_changed { runtime = Some(routing::current_source().1); }
    writes.insert(0, Replacement { path: path.into(), previous, next: content.as_bytes().into() });
    let index = get_profiles_index_file();
    let previous = fs::read(&index).map_err(|error| format!("读取旧订阅索引失败，{error}"))?;
    let next = serde_json::to_vec_pretty(profiles).map_err(|_| "序列化订阅索引失败")?;
    writes.push(Replacement { path: index, previous, next });

    let mut written = 0;
    let result = async {
        for write in &writes {
            storage::replace_atomic(&write.path, &write.next)?;
            written += 1;
        }
        routing::invalidate_profile_targets(&profile.id);
        if let Some(path) = runtime {
            let raw = fs::read_to_string(path).map_err(|error| format!("读取运行订阅失败，{error}"))?;
            let (raw, _) = super::sanitize_profile_rules(&raw);
            let config = routing::read()?;
            let active_id = routing::current_source().0;
            super::apply_profile_runtime(&raw, &active_id, &config).await?;
        }
        Ok::<(), String>(())
    }.await;
    if let Err(error) = result {
        let mut failures = Vec::new();
        for write in writes[..written].iter().rev() {
            if let Err(restore) = storage::replace_atomic(&write.path, &write.previous) {
                failures.push(restore);
            }
        }
        routing::invalidate_profile_targets(&profile.id);
        return Err(if failures.is_empty() { format!("订阅更新失败，已恢复原订阅和出口绑定。{error}") }
            else { format!("订阅更新失败，{error}。恢复失败，{}", failures.join("，")) });
    }
    Ok(())
}
