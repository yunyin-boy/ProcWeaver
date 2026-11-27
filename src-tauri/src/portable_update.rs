use crate::commands::maintenance::{format_bytes, get_running_proxy_port, AppUpdateInfo};
use crate::commands::process::CoreStateMutex;
use procweaver_portable_update as installer;
use installer::{stable_version, Edition, Manifest, Version, ARCHIVE_FILE, MANIFEST_FILE};
use serde::Deserialize;
use std::time::Duration;
use tauri::{Emitter, Manager, State, WebviewWindow};
use tokio::io::AsyncWriteExt;

const REPO: &str = "https://github.com/yunyin-boy/ProcWeaver";
const FEED: &str = "https://api.github.com/repos/yunyin-boy/ProcWeaver/releases?per_page=30";
const CURRENT: &str = env!("CARGO_PKG_VERSION");
const EDITION: Edition = if crate::edition::PROCESS { Edition::Process } else { Edition::Full };
static UPDATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    browser_download_url: String,
}

struct Candidate<'a> {
    version: Version,
    release: &'a Release,
    package: &'a Asset,
    manifest: Option<&'a Asset>,
}

fn find_release<'a>(releases: &'a [Release], edition: Edition, requested: Option<&Version>) -> Option<Candidate<'a>> {
    releases.iter()
        .filter(|release| !release.draft && !release.prerelease)
        .filter_map(|release| {
            let version = stable_version(&release.tag_name)?;
            if requested.is_some_and(|requested| requested != &version) { return None; }
            let asset = |name: String, max_size: u64| {
                let url = format!("{REPO}/releases/download/{}/{name}", release.tag_name);
                release.assets.iter().find(|asset| asset.name == name
                    && asset.browser_download_url == url && (1..=max_size).contains(&asset.size))
            };
            let package = asset(edition.package_name(&version), installer::MAX_ARCHIVE_BYTES)?;
            let manifest = asset(edition.manifest_name(&version), installer::MAX_MANIFEST_BYTES);
            Some(Candidate { version, release, package, manifest })
        })
        .max_by(|a, b| a.version.cmp(&b.version))
}

fn client(proxy: Option<u16>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().https_only(true)
        .user_agent(concat!("ProcWeaver/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(25))
        .timeout(Duration::from_secs(240));
    if let Some(port) = proxy {
        builder = builder.proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))
            .map_err(|_| "无法连接应用更新通道")?);
    }
    builder.build().map_err(|_| "无法初始化更新请求".into())
}

async fn releases(proxy: Option<u16>) -> Result<(reqwest::Client, Vec<Release>), String> {
    let request = |client: reqwest::Client| async move {
        let releases = client.get(FEED).header("Accept", "application/vnd.github+json")
            .timeout(Duration::from_secs(20)).send().await?
            .error_for_status()?.json().await?;
        Ok::<_, reqwest::Error>((client, releases))
    };
    match request(client(proxy)?).await {
        Ok(result) => Ok(result),
        Err(_) if proxy.is_some() => request(client(None)?).await.map_err(|error| format!("无法读取 GitHub 更新，{error}")),
        Err(error) => Err(format!("无法读取 GitHub 更新，{error}")),
    }
}

#[tauri::command]
pub(crate) async fn check_app_update(state: State<'_, CoreStateMutex>) -> Result<AppUpdateInfo, String> {
    let (_, releases) = releases(get_running_proxy_port(&state)).await?;
    let current = stable_version(CURRENT).ok_or("当前程序版本无效")?;
    let found = find_release(&releases, EDITION, None);
    let latest = found.as_ref().map_or(&current, |candidate| &candidate.version).max(&current);
    let metadata = found.as_ref().map(|candidate| candidate.release);
    let bytes = found.as_ref().map_or(0, |candidate| candidate.package.size);
    Ok(AppUpdateInfo {
        current_version: format!("V{current}"),
        latest_version: format!("v{latest}"),
        has_update: latest > &current,
        release_name: metadata.and_then(|release| release.name.clone()).unwrap_or_else(|| format!("v{latest}")),
        release_notes: metadata.and_then(|release| release.body.clone()).unwrap_or_default(),
        published_at: metadata.and_then(|release| release.published_at.clone()).unwrap_or_default(),
        download_url: found.as_ref().filter(|candidate| candidate.manifest.is_some())
            .map(|candidate| candidate.package.browser_download_url.clone()),
        asset_name: found.as_ref().map(|candidate| candidate.package.name.clone()),
        asset_size_bytes: bytes,
        asset_size_formatted: format_bytes(bytes),
        html_url: metadata.map_or_else(|| format!("{REPO}/releases"), |release| format!("{REPO}/releases/tag/{}", release.tag_name)),
        repo_url: REPO.into(),
    })
}

async fn download_manifest(client: &reqwest::Client, asset: &Asset) -> Result<Vec<u8>, String> {
    let mut response = client.get(&asset.browser_download_url).timeout(Duration::from_secs(30))
        .send().await.and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("下载更新清单失败，{error}"))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取更新清单失败")? {
        if bytes.len() as u64 + chunk.len() as u64 > installer::MAX_MANIFEST_BYTES {
            return Err("更新清单超过大小限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn download_package(client: &reqwest::Client, asset: &Asset, path: &std::path::Path) -> Result<(), String> {
    let mut response = client.get(&asset.browser_download_url).send().await
        .and_then(reqwest::Response::error_for_status).map_err(|error| format!("下载更新包失败，{error}"))?;
    let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(path).await
        .map_err(|error| format!("无法创建更新缓存，{error}"))?;
    let mut received = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("读取更新包失败，{error}"))? {
        received += chunk.len() as u64;
        if received > asset.size { return Err("更新包超过签名清单中的大小".into()); }
        file.write_all(&chunk).await.map_err(|error| format!("写入更新包失败，{error}"))?;
    }
    if received != asset.size { return Err("更新包下载不完整".into()); }
    file.sync_all().await.map_err(|error| format!("保存更新包失败，{error}"))
}

#[tauri::command]
pub(crate) async fn apply_portable_update(window: WebviewWindow, state: State<'_, CoreStateMutex>, version: String) -> Result<(), String> {
    if window.label() != "main" { return Err("请在主工作台更新应用".into()); }
    let _update = UPDATE.try_lock().map_err(|_| "已有更新正在执行")?;
    if crate::shutdown::in_progress() { return Err("程序正在退出".into()); }
    let requested = stable_version(&version).ok_or("目标版本无效")?;
    if requested <= stable_version(CURRENT).ok_or("当前程序版本无效")? {
        return Err("目标版本必须高于当前版本".into());
    }
    let workspace = installer::workspace(EDITION)?;
    let (client, releases) = releases(get_running_proxy_port(&state)).await?;
    let candidate = find_release(&releases, EDITION, Some(&requested)).ok_or("找不到此版本的绿色便携包")?;
    let manifest_asset = candidate.manifest.ok_or("此版本尚未提供签名更新清单")?;
    let envelope = download_manifest(&client, manifest_asset).await?;
    let manifest = Manifest::verify(&envelope, EDITION, &requested)?;
    if manifest.bytes != candidate.package.size { return Err("更新附件大小与签名清单不符".into()); }
    tokio::fs::write(workspace.path().join(MANIFEST_FILE), &envelope).await
        .map_err(|error| format!("保存更新清单失败，{error}"))?;
    download_package(&client, candidate.package, &workspace.path().join(ARCHIVE_FILE)).await?;
    let version = requested.to_string();
    let _ = window.emit("procweaver-update-preparing", ());
    let work = tauri::async_runtime::spawn_blocking(move || installer::launch_installer(workspace, EDITION, CURRENT, &version))
        .await.map_err(|error| format!("更新助手准备失败，{error}"))??;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..90 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Ok(text) = tokio::fs::read(work.join("error.json")).await {
                if let Ok(error) = serde_json::from_slice::<String>(&text) {
                    let _ = app.emit("procweaver-update-error", error);
                    break;
                }
            }
        }
    });
    crate::shutdown::request(window.app_handle(), 0);
    Ok(())
}

#[tauri::command]
pub(crate) async fn portable_workbench_ready(window: WebviewWindow) -> Result<Option<installer::Outcome>, String> {
    if window.label() != "main" { return Ok(None); }
    tauri::async_runtime::spawn_blocking(|| installer::report_workbench_ready(EDITION, CURRENT))
        .await.map_err(|error| error.to_string())?
}

pub fn bootstrap_app() -> bool {
    match installer::bootstrap(EDITION, CURRENT) {
        Ok(proceed) => proceed,
        Err(error) => {
            use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
            let message: Vec<_> = format!("无法恢复便携更新，{error}\0").encode_utf16().collect();
            let title: Vec<_> = "ProcWeaver\0".encode_utf16().collect();
            unsafe { MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR); }
            false
        }
    }
}

pub(crate) fn watch_trial(app: &tauri::AppHandle) {
    if installer::trial_abort_requested(EDITION).is_none() { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match installer::trial_abort_requested(EDITION) {
                None => break,
                Some(true) => {
                    crate::shutdown::request(&app, 0);
                    break;
                }
                Some(false) => tokio::time::sleep(Duration::from_millis(400)).await,
            }
        }
    });
}
