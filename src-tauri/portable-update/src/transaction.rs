use crate::manifest::{file_error, stable_version, Edition, Manifest, DEFAULT_CONFIG, UPDATER_EXE};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    env,
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::{self, Write},
    os::windows::{ffi::OsStringExt, fs::{MetadataExt, OpenOptionsExt}},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0},
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    },
};

pub const ARCHIVE_FILE: &str = "package.zip";
pub const MANIFEST_FILE: &str = "release.json";
const CONTROL_DIR: &str = ".procweaver-update";
const PENDING: &str = "pending.json";
const RESULT: &str = "last-result.json";
const TRIAL_PREFIX: &str = "--portable-update-trial=";
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const WAIT_FOR_EXIT_MS: u32 = 40_000;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
const POLL: Duration = Duration::from_millis(100);

#[derive(Deserialize, Serialize)]
struct Plan {
    edition: Edition,
    current: String,
    version: String,
}

#[derive(Deserialize, Serialize)]
struct Change {
    path: String,
    existed: bool,
}

#[derive(Deserialize, Serialize)]
struct Journal {
    session: String,
    changes: Vec<Change>,
}

#[derive(Deserialize, Serialize)]
struct Ready {
    pid: u32,
    version: String,
}

#[derive(Deserialize, Serialize)]
pub struct Outcome {
    pub version: String,
    pub success: bool,
    pub message: String,
}

fn inspect(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 =>
            Err(format!("更新路径存在链接或重解析点 {}", path.display())),
        Ok(meta) => Ok(Some(meta)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(file_error(error)),
    }
}

fn is_file(path: &Path) -> Result<bool, String> {
    match inspect(path)? {
        Some(meta) if meta.is_file() => Ok(true),
        Some(_) => Err(format!("更新路径不是文件 {}", path.display())),
        None => Ok(false),
    }
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    match inspect(path)? {
        Some(meta) if meta.is_dir() => Ok(()),
        Some(_) => Err(format!("更新路径不是目录 {}", path.display())),
        None => match fs::create_dir(path) {
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => ensure_dir(path),
            result => result.map_err(file_error),
        },
    }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    if !is_file(path)? { return Err(format!("缺少更新状态 {}", path.display())); }
    let file = File::open(path).map_err(file_error)?;
    if file.metadata().map_err(file_error)?.len() > crate::MAX_MANIFEST_BYTES {
        return Err("更新状态超过大小限制".into());
    }
    serde_json::from_reader(file).map_err(|error| error.to_string())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("更新状态路径无效")?)
        .map_err(file_error)?;
    serde_json::to_writer(&mut file, value).map_err(|error| error.to_string())?;
    file.flush().map_err(file_error)?;
    file.as_file().sync_all().map_err(file_error)?;
    file.persist(path).map_err(|error| file_error(error.error))?;
    Ok(())
}

fn app_root(edition: Edition) -> Result<PathBuf, String> {
    let path = env::current_exe().map_err(file_error)?.canonicalize().map_err(file_error)?;
    if !path.file_name().is_some_and(|name| name.eq_ignore_ascii_case(edition.executable())) {
        return Err("便携更新需要使用原始程序文件名".into());
    }
    let root = path.parent().ok_or("找不到便携程序目录")?;
    if !is_file(&root.join(edition.portable_marker()))? {
        return Err("请解压此版本的绿色便携包后使用应用内更新".into());
    }
    Ok(root.to_path_buf())
}

fn lock_control(control: &Path) -> Result<Option<File>, String> {
    let lock = control.join("update.lock");
    is_file(&lock)?;
    match OpenOptions::new().write(true).create(true).truncate(false).share_mode(0).open(lock) {
        Ok(handle) => Ok(Some(handle)),
        Err(error) if error.raw_os_error() == Some(32) => Ok(None),
        Err(error) => Err(file_error(error)),
    }
}

fn valid_session(name: &str) -> bool {
    name.strip_prefix("session-").is_some_and(|id| id.len() == 12 && id.bytes().all(|ch| ch.is_ascii_alphanumeric()))
}

fn session_path(control: &Path, session: &str) -> Result<PathBuf, String> {
    if !valid_session(session) { return Err("更新会话名称无效".into()); }
    let work = control.join(session);
    if !inspect(&work)?.is_some_and(|meta| meta.is_dir()) {
        return Err("更新会话目录不可用".into());
    }
    Ok(work)
}

pub fn workspace(edition: Edition) -> Result<tempfile::TempDir, String> {
    let control = app_root(edition)?.join(CONTROL_DIR);
    ensure_dir(&control)?;
    let _lock = lock_control(&control)?.ok_or("已有更新正在执行")?;
    if is_file(&control.join(PENDING))? {
        return Err("有未完成的更新，请重启以恢复".into());
    }
    tempfile::Builder::new().prefix("session-").rand_bytes(12).tempdir_in(control).map_err(file_error)
}

pub fn launch_installer(work: tempfile::TempDir, edition: Edition, current: &str, version: &str) -> Result<PathBuf, String> {
    let root = app_root(edition)?;
    let helper = root.join(UPDATER_EXE);
    if !is_file(&helper)? { return Err("找不到便携更新助手，请重新解压绿色便携包".into()); }
    fs::copy(helper, work.path().join(UPDATER_EXE)).map_err(file_error)?;
    write_json(&work.path().join("plan.json"), &Plan { edition, current: current.into(), version: version.into() })?;
    launch_helper(work.path(), "apply", Duration::from_secs(60))?;
    Ok(work.keep())
}

fn launch_helper(work: &Path, operation: &str, timeout: Duration) -> Result<(), String> {
    let armed = work.join(format!("armed-{operation}"));
    if is_file(&armed)? { fs::remove_file(&armed).map_err(file_error)?; }
    let mut child = Command::new(work.join(UPDATER_EXE))
        .args([operation, &std::process::id().to_string()])
        .current_dir(work).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|error| format!("无法启动更新助手 {error}"))?;
    let deadline = Instant::now() + timeout;
    loop {
        if child.try_wait().map_err(file_error)?.is_some() {
            return Err(read_json::<String>(&work.join("error.json")).unwrap_or_else(|_| "更新助手启动失败".into()));
        }
        if is_file(&armed)? { return Ok(()); }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("更新助手准备超时".into());
        }
        thread::sleep(POLL);
    }
}

fn trial_session() -> Option<String> {
    env::args_os().skip(1).find_map(|arg| {
        let name = arg.to_str()?.strip_prefix(TRIAL_PREFIX)?;
        valid_session(name).then(|| name.to_string())
    })
}

/// Before opening a workbench, let an interrupted replacement restore its files.
pub fn bootstrap(edition: Edition, version: &str) -> Result<bool, String> {
    let Ok(root) = app_root(edition) else { return Ok(true); };
    let control = root.join(CONTROL_DIR);
    let pending = control.join(PENDING);
    if inspect(&control)?.is_none() { return Ok(true); }
    let lock = lock_control(&control)?;
    if !is_file(&pending)? { return Ok(lock.is_some()); }
    let journal: Journal = read_json(&pending)?;
    let work = session_path(&control, &journal.session)?;
    let plan: Plan = read_json(&work.join("plan.json"))?;
    if plan.edition != edition { return Err("待恢复更新属于另一种版本类型".into()); }
    match lock {
        None => Ok(trial_session().as_deref() == Some(&journal.session) && plan.version == version),
        Some(lock) => {
            drop(lock);
            launch_helper(&work, "recover", Duration::from_secs(10))?;
            Ok(false)
        }
    }
}

/// None indicates that this process is not running as an update trial any more.
pub fn trial_abort_requested(edition: Edition) -> Option<bool> {
    let session = trial_session()?;
    let control = app_root(edition).ok()?.join(CONTROL_DIR);
    let journal: Journal = read_json(&control.join(PENDING)).ok()?;
    if journal.session != session { return None; }
    let work = session_path(&control, &session).ok()?;
    Some(read_json::<u32>(&work.join("rollback.json")).ok() == Some(std::process::id()))
}

pub fn report_workbench_ready(edition: Edition, version: &str) -> Result<Option<Outcome>, String> {
    let Ok(root) = app_root(edition) else { return Ok(None); };
    let control = root.join(CONTROL_DIR);
    if inspect(&control)?.is_none() { return Ok(None); }
    if let Some(session) = trial_session() {
        let pending = control.join(PENDING);
        if is_file(&pending)? {
            let journal: Journal = read_json(&pending)?;
            if journal.session == session {
                let work = session_path(&control, &session)?;
                let plan: Plan = read_json(&work.join("plan.json"))?;
                if plan.edition == edition && plan.version == version {
                    write_json(&work.join("workbench.json"), &Ready { pid: std::process::id(), version: version.into() })?;
                    // The helper writes the outcome only after accepting this readiness message.
                    let deadline = Instant::now() + Duration::from_secs(5);
                    while is_file(&pending)? && Instant::now() < deadline { thread::sleep(POLL); }
                }
            }
        }
    }
    let result = control.join(RESULT);
    if is_file(&result)? { return read_json(&result).map(Some); }
    Ok(None)
}

struct ProcessHandle(HANDLE);

impl Drop for ProcessHandle {
    fn drop(&mut self) { unsafe { CloseHandle(self.0); } }
}

fn open_parent(pid: u32, expected: &Path) -> Result<ProcessHandle, String> {
    let raw = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if raw.is_null() { return Err("无法打开当前程序的进程句柄".into()); }
    let handle = ProcessHandle(raw);
    let mut path = vec![0u16; 32_768];
    let mut len = path.len() as u32;
    if unsafe { QueryFullProcessImageNameW(raw, 0, path.as_mut_ptr(), &mut len) } == 0 {
        return Err("无法确认当前程序路径".into());
    }
    let actual = PathBuf::from(OsString::from_wide(&path[..len as usize])).canonicalize().map_err(file_error)?;
    if actual != expected.canonicalize().map_err(file_error)? {
        return Err("更新助手的等待进程与便携程序路径不符".into());
    }
    Ok(handle)
}

fn destination(root: &Path, name: &str, create: bool) -> Result<PathBuf, String> {
    let relative = Path::new(name);
    let mut current = root.to_path_buf();
    for directory in relative.parent().ok_or("相对路径无效")?.components() {
        current.push(directory);
        if create {
            ensure_dir(&current)?;
        } else if let Some(meta) = inspect(&current)? {
            if !meta.is_dir() { return Err(format!("更新目标不是目录 {}", current.display())); }
        }
    }
    current.push(relative.file_name().ok_or("更新文件名无效")?);
    Ok(current)
}

fn copy_file(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target.parent().ok_or("更新路径无效")?).map_err(file_error)?;
    fs::copy(source, target).map_err(file_error)?;
    OpenOptions::new().write(true).open(target).and_then(|f| f.sync_all()).map_err(file_error)
}

fn backup_files(root: &Path, work: &Path, manifest: &Manifest) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    for file in &manifest.files {
        let path = destination(root, &file.path, false)?;
        let existed = is_file(&path)?;
        if existed && matches!(file.path.as_str(), DEFAULT_CONFIG) { continue; }
        if existed {
            copy_file(&path, &work.join("previous").join(&file.path))
                .map_err(|error| format!("备份 {} 失败，{error}", file.path))?;
        }
        changes.push(Change { path: file.path.clone(), existed });
    }
    // The executable is the last replacement, so an early interruption still leaves it launchable.
    changes.sort_by_key(|change| change.path == manifest.edition.executable());
    Ok(changes)
}

fn restore_files(root: &Path, work: &Path, journal: &Journal, manifest: &Manifest) -> Result<(), String> {
    for change in journal.changes.iter().rev() {
        if !manifest.files.iter().any(|file| file.path == change.path) {
            return Err("回退清单包含未知文件".into());
        }
        if is_file(&work.join("staged").join(&change.path))? { continue; }
        let path = destination(root, &change.path, change.existed)?;
        is_file(&path)?;
        if change.existed {
            let restored = work.join("restore").join(&change.path);
            copy_file(&work.join("previous").join(&change.path), &restored)?;
            fs::rename(restored, &path).map_err(file_error)?;
        } else if is_file(&path)? {
            fs::remove_file(&path).map_err(file_error)?;
        }
    }
    Ok(())
}

fn start_app(root: &Path, edition: Edition, args: impl IntoIterator<Item = impl AsRef<OsStr>>) -> Result<Child, String> {
    Command::new(root.join(edition.executable())).args(args).current_dir(root)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(file_error)
}

fn launch_trial(root: &Path, work: &Path, plan: &Plan, session: &str) -> Result<(), String> {
    let mut child = start_app(root, plan.edition, [format!("{TRIAL_PREFIX}{session}")])?;
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    let readiness = work.join("workbench.json");
    let reason = loop {
        if child.try_wait().map_err(file_error)?.is_some() {
            return Err("新版未进入工作台便已退出".into());
        }
        if let Ok(ready) = read_json::<Ready>(&readiness) {
            if ready.pid == child.id() && ready.version == plan.version { return Ok(()); }
        }
        if Instant::now() >= deadline { break "等待新版工作台超时"; }
        thread::sleep(POLL);
    };
    // Allow the trial process to release its own network state before taking it down.
    write_json(&work.join("rollback.json"), &child.id())?;
    let end = Instant::now() + Duration::from_secs(6);
    while Instant::now() < end {
        if child.try_wait().map_err(file_error)?.is_some() { return Err(reason.into()); }
        thread::sleep(POLL);
    }
    child.kill().map_err(file_error)?;
    child.wait().map_err(file_error)?;
    Err(reason.into())
}

fn apply(root: &Path, work: &Path, control: &Path, session: &str, plan: &Plan, manifest: &Manifest) -> Result<bool, String> {
    let journal = Journal { session: session.into(), changes: backup_files(root, work, manifest)? };
    write_json(&control.join(PENDING), &journal)?;
    let result = (|| {
        for change in &journal.changes {
            let path = destination(root, &change.path, true)?;
            is_file(&path)?;
            fs::rename(work.join("staged").join(&change.path), path)
                .map_err(|error| format!("无法替换 {}，{error}", change.path))?;
        }
        launch_trial(root, work, plan, session)
    })();
    let outcome = match result {
        Ok(()) => Outcome { version: plan.version.clone(), success: true, message: format!("已更新到 {}", plan.version) },
        Err(error) => {
            restore_files(root, work, &journal, manifest)
                .map_err(|restore| format!("{error}，回退需要恢复，{restore}"))?;
            Outcome { version: plan.version.clone(), success: false, message: format!("更新失败，已恢复旧版。{error}") }
        }
    };
    finish(work, control, outcome)
}

fn finish(work: &Path, control: &Path, outcome: Outcome) -> Result<bool, String> {
    write_json(&control.join(RESULT), &outcome)?;
    if is_file(&control.join(PENDING))? { fs::remove_file(control.join(PENDING)).map_err(file_error)?; }
    for name in ["staged", "previous", "restore"] {
        let directory = work.join(name);
        if inspect(&directory)?.is_some_and(|meta| meta.is_dir()) { let _ = fs::remove_dir_all(directory); }
    }
    let _ = fs::remove_file(work.join(ARCHIVE_FILE));
    Ok(!outcome.success)
}

fn run_session(operation: &str, parent: u32, work: &Path, control: &Path, root: &Path, session: &str) -> Result<(), String> {
    let lock = lock_control(control)?.ok_or("已有更新正在执行")?;
    let plan: Plan = read_json(&work.join("plan.json"))?;
    let current = stable_version(&plan.current).ok_or("当前程序版本无效")?;
    let version = stable_version(&plan.version).ok_or("更新版本无效")?;
    if version <= current || !is_file(&root.join(plan.edition.portable_marker()))? {
        return Err("更新版本或便携目录不符".into());
    }
    let handle = open_parent(parent, &root.join(plan.edition.executable()))?;
    let envelope = fs::read(work.join(MANIFEST_FILE)).map_err(file_error)?;
    let manifest = Manifest::verify(&envelope, plan.edition, &version)?;
    if operation == "apply" {
        if is_file(&control.join(PENDING))? { return Err("有未完成的更新，请先恢复".into()); }
        let staged = work.join("staged");
        ensure_dir(&staged)?;
        manifest.unpack(&work.join(ARCHIVE_FILE), &staged)?;
    }
    let marker = work.join(format!("armed-{operation}"));
    File::create(&marker).and_then(|file| file.sync_all()).map_err(file_error)?;
    if unsafe { WaitForSingleObject(handle.0, WAIT_FOR_EXIT_MS) } != WAIT_OBJECT_0 {
        return Err("等待当前程序正常退出超时".into());
    }
    let restart_old = if operation == "recover" {
        let journal: Journal = read_json(&control.join(PENDING))?;
        if journal.session != session { return Err("不是当前待恢复的更新会话".into()); }
        restore_files(root, work, &journal, &manifest)?;
        let outcome = Outcome { version: plan.version.clone(), success: false, message: "上次更新中断，已恢复旧版".into() };
        finish(work, control, outcome)?
    } else {
        match apply(root, work, control, session, &plan, &manifest) {
            Ok(restart_old) => restart_old,
            // If the backup itself fails, no installed file has been replaced.
            Err(error) if !is_file(&control.join(PENDING))? => {
                let outcome = Outcome { version: plan.version.clone(), success: false, message: format!("更新失败，已保留旧版。{error}") };
                finish(work, control, outcome)?
            }
            Err(error) => return Err(error),
        }
    };
    drop(lock);
    if restart_old { start_app(root, plan.edition, std::iter::empty::<&str>())?; }
    Ok(())
}

pub fn run_updater() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let operation = args.next().filter(|arg| matches!(arg.as_str(), "apply" | "recover")).ok_or("未知更新操作")?;
    let parent = args.next().and_then(|arg| arg.parse::<u32>().ok()).filter(|pid| *pid != 0).ok_or("当前进程编号无效")?;
    let exe = env::current_exe().map_err(file_error)?.canonicalize().map_err(file_error)?;
    let work = exe.parent().ok_or("更新会话目录无效")?;
    let control = work.parent().ok_or("更新状态目录无效")?;
    let root = control.parent().ok_or("安装目录无效")?;
    let session = work.file_name().and_then(OsStr::to_str).filter(|name| valid_session(name)).ok_or("更新会话名称无效")?;
    if control.file_name() != Some(OsStr::new(CONTROL_DIR)) || !is_file(&exe)? {
        return Err("更新助手必须从便携更新会话启动".into());
    }
    if let Err(error) = run_session(&operation, parent, work, control, root, session) {
        let _ = write_json(&work.join("error.json"), &error);
        return Err(error);
    }
    Ok(())
}
