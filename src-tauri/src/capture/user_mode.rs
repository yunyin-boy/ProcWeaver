//! 用户态强接管（免驱动 · 注入 Hook · 路线 B 真实 DNS 解析）
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

pub const MODE: &str = "user_mode";
#[cfg(windows)]
#[path = "hook_control.rs"]
pub(crate) mod control;
#[cfg(windows)]
pub use control::SessionPolicy;

#[cfg(windows)]
pub fn matches_session(pid: u32, policy: SessionPolicy<'_>, port: u16, action: Option<&str>) -> bool {
    let process = crate::routing_overrides::native::inspect(pid, 0, String::new());
    control::matches(pid, process.created_at, policy, port, action == Some("REJECT"))
}

#[cfg(windows)]
pub fn previous_proxy_ports(pid: u32) -> Vec<u16> {
    let process = crate::routing_overrides::native::inspect(pid, 0, String::new());
    control::previous_proxy_ports(pid, process.created_at)
}
#[cfg(windows)]
struct PendingLease { name: Option<String>, committed: bool }
#[cfg(windows)]
impl Drop for PendingLease {
    fn drop(&mut self) { if !self.committed { if let Some(name) = &self.name { control::revoke(name); } } }
}

pub fn is_executable_64bit(path: &Path) -> Result<bool, String> {
    let mut file = File::open(path).map_err(|e| format!("无法读取可执行文件 {}: {e}", path.display()))?;
    let mut dos_header = [0u8; 64];
    file.read_exact(&mut dos_header).map_err(|e| format!("读取 DOS 头失败: {e}"))?;

    if dos_header[0] != b'M' || dos_header[1] != b'Z' {
        return Err("不是有效的 Windows 可执行文件 (缺少 MZ 签名)".into());
    }

    let e_lfanew = u32::from_le_bytes([
        dos_header[0x3C],
        dos_header[0x3D],
        dos_header[0x3E],
        dos_header[0x3F],
    ]) as u64;

    file.seek(SeekFrom::Start(e_lfanew))
        .map_err(|e| format!("定位 PE 头失败: {e}"))?;

    let mut pe_signature_and_machine = [0u8; 6];
    file.read_exact(&mut pe_signature_and_machine)
        .map_err(|e| format!("读取 PE 标识失败: {e}"))?;

    if &pe_signature_and_machine[0..4] != b"PE\0\0" {
        return Err("不是有效的 PE 文件 (缺少 PE 签名)".into());
    }

    let machine = u16::from_le_bytes([pe_signature_and_machine[4], pe_signature_and_machine[5]]);
    match machine {
        0x8664 => Ok(true),   // x64 / AMD64
        0x014c => Ok(false),  // x86 / 32-bit
        0xaa64 => Ok(true),   // ARM64 视同 64 位
        _ => Err(format!("未知或不受支持的机器架构代码: 0x{machine:04X}")),
    }
}

pub fn hook_dll_path(is_64bit: bool) -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(path) = std::env::var_os(if is_64bit { "PROCWEAVER_TEST_HOOK64" } else { "PROCWEAVER_TEST_HOOK32" }) {
        let path = PathBuf::from(path);
        if path.is_file() { return Ok(path); }
        return Err("隔离 Hook 测试组件不存在".into());
    }
    let filename = if is_64bit { "pw_hook64.dll" } else { "pw_hook32.dll" };

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("binaries").join("hook").join(filename);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let candidate = manifest_dir.join("binaries").join("hook").join(filename);
        if candidate.is_file() {
            return Ok(candidate);
        }
        let top_candidate = manifest_dir.parent().unwrap_or(manifest_dir).join("binaries").join("hook").join(filename);
        if top_candidate.is_file() {
            return Ok(top_candidate);
        }
    }

    Err(format!("未找到用户态 Hook 动态库组件 ({filename})，请确认资源已完整生成"))
}

#[cfg(windows)]
fn ensure_hook_dir_acl(dir: &Path) {
    use std::os::windows::process::CommandExt;
    // 为 Hook 组件目录赋予 ALL APPLICATION PACKAGES (S-1-15-2-1) 读取与执行权限
    // 确保 Chrome / Edge 等具有低完整性沙盒或 AppContainer 特性的网络进程能成功加载 DLL
    let _ = std::process::Command::new("icacls")
        .arg(dir)
        .args(["/grant", "*S-1-15-2-1:(OI)(CI)RX", "/t", "/q"])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output();
}

#[cfg(windows)]
#[allow(non_snake_case)]
type PfnPwLaunchProcess = unsafe extern "system" fn(
    lpApplicationName: *const u16,
    lpCommandLine: *mut u16,
    lpCurrentDirectory: *const u16,
    lpDllPath: *const u8,
    lpEnvironment: *mut std::ffi::c_void,
    lpPid: *mut u32,
) -> windows_sys::Win32::Foundation::BOOL;

#[cfg(windows)]
const REJECT_LAUNCHER_EXPORT: &[u8] = b"PwLaunchProcessWithVerifiedReject\0";

#[cfg(windows)]
pub fn verify_policy_launcher() -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{Foundation::FreeLibrary, System::LibraryLoader::{GetProcAddress, LoadLibraryW}};
    let dll: Vec<u16> = hook_dll_path(true)?.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let module = LoadLibraryW(dll.as_ptr());
        if module.is_null() { return Err("无法加载 Hook 启动组件，未确认策略接入能力".into()); }
        let supported = GetProcAddress(module, REJECT_LAUNCHER_EXPORT.as_ptr()).is_some();
        FreeLibrary(module);
        if !supported { return Err("Hook 组件版本过旧，请更新组件后再启用接管".into()); }
    }
    Ok(())
}

#[cfg(all(windows, test))]
pub fn launch_with_hook(
    exe: &Path,
    args: &[String],
    working_dir: Option<&Path>,
    bundle_port: u16,
    dns_port: u16,
    policy: Option<&crate::routing_overrides::model::BundlePolicy>,
    native_proxy: bool,
) -> Result<u32, String> {
    launch_with_hook_action(exe, args, working_dir, bundle_port, dns_port, policy, native_proxy, None, None)
}

#[cfg(windows)]
pub fn launch_with_hook_action(
    exe: &Path,
    args: &[String],
    working_dir: Option<&Path>,
    bundle_port: u16,
    dns_port: u16,
    policy: Option<&crate::routing_overrides::model::BundlePolicy>,
    native_proxy: bool,
    action: Option<&str>,
    session: Option<SessionPolicy<'_>>,
) -> Result<u32, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{Foundation::FreeLibrary, System::LibraryLoader::{GetProcAddress, LoadLibraryW}};

    let is_64bit = is_executable_64bit(exe)?;
    let target_dll = hook_dll_path(is_64bit)?;

    if let Some(parent) = target_dll.parent() {
        ensure_hook_dir_acl(parent);
    }

    let reject = action == Some("REJECT");
    let environment = hook_environment_with_action(bundle_port, dns_port, policy, native_proxy, action, session)?;
    let mut lease = PendingLease { name: environment.iter().find(|(k, _)| k == "PROCWEAVER_HOOK_CONTROL").map(|(_, v)| v.to_string_lossy().into_owned()), committed: false };
    let mut environment_block = environment_block(&environment);

    // 优先尝试使用 Detours 官方原生导入表注入器 (PwLaunchProcess)
    let launcher_dll = hook_dll_path(true)?;
    let launcher_dll_wide: Vec<u16> = launcher_dll.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    let exe_wide: Vec<u16> = exe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    let full_cmd = if args.is_empty() {
        format!("\"{}\"", exe.display())
    } else {
        let mut line = format!("\"{}\"", exe.display());
        for arg in args {
            line.push(' ');
            if arg.contains(' ') || arg.contains('\t') || arg.contains('"') {
                line.push('"');
                line.push_str(&arg.replace('"', "\\\""));
                line.push('"');
            } else {
                line.push_str(arg);
            }
        }
        line
    };
    let mut cmd_wide: Vec<u16> = std::ffi::OsString::from(full_cmd)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let dir_wide: Option<Vec<u16>> = working_dir
        .or_else(|| exe.parent())
        .map(|d| d.as_os_str().encode_wide().chain(std::iter::once(0)).collect());

    let dll_path_ansi = std::ffi::CString::new(target_dll.to_string_lossy().as_bytes())
        .map_err(|e| format!("路径包含非法字符: {e}"))?;

    unsafe {
        let h_launcher = LoadLibraryW(launcher_dll_wide.as_ptr());
        if !h_launcher.is_null() {
            if uses_core_listener(bundle_port) && GetProcAddress(h_launcher, b"PwSuiteDnsVersion\0".as_ptr()).is_none() {
                FreeLibrary(h_launcher);
                return Err("Hook 组件缺少套件 DNS 模式支持，请更新 Hook 组件".into());
            }
            let export = if reject { REJECT_LAUNCHER_EXPORT }
                else { b"PwLaunchProcessWithEnvironment\0".as_slice() };
            let proc_addr = GetProcAddress(h_launcher, export.as_ptr());
            if let Some(fn_ptr) = proc_addr {
                let pfn: PfnPwLaunchProcess = std::mem::transmute(fn_ptr);
                let mut pid: u32 = 0;
                let ok = pfn(
                    exe_wide.as_ptr(),
                    cmd_wide.as_mut_ptr(),
                    dir_wide.as_ref().map_or(std::ptr::null(), |v| v.as_ptr()),
                    dll_path_ansi.as_ptr() as *const u8,
                    environment_block.as_mut_ptr().cast(),
                    &mut pid,
                );
                FreeLibrary(h_launcher);
                if ok != 0 && pid != 0 {
                    let created_at = check_process_alive_after_launch(pid)?;
                    if let Some(name) = &lease.name { control::confirm(name, pid, created_at, native_proxy)?; }
                    lease.committed = true;
                    return Ok(pid);
                }
            } else {
                FreeLibrary(h_launcher);
                return Err("Hook 组件版本过旧，无法确认或撤销接管；请更新 Hook 组件后重试".into());
            }
        }
    }

    if reject { return Err("未确认 Hook 网络阻断，启动失败".into()); }
    // Fallback：挂起远程线程方式
    let pid = launch_with_remote_thread_fallback(exe, args, working_dir, &target_dll, &environment)?;
    let created_at = check_process_alive_after_launch(pid)?;
    if let Some(name) = &lease.name { control::confirm(name, pid, created_at, native_proxy)?; }
    lease.committed = true;
    Ok(pid)
}

#[cfg(windows)]
fn check_process_alive_after_launch(pid: u32) -> Result<u64, String> {
    unsafe {
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        const STILL_ACTIVE: u32 = 259;
        let h_proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h_proc.is_null() {
            return Err("受控进程启动后句柄无法打开或进程已过早退出；请确认权限并完全退出旧实例后重试".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
        let mut exit_code: u32 = 0;
        let ok = GetExitCodeProcess(h_proc, &mut exit_code);
        let mut created = std::mem::zeroed();
        let mut exit = std::mem::zeroed();
        let mut kernel = std::mem::zeroed();
        let mut user = std::mem::zeroed();
        let verified = GetProcessTimes(h_proc, &mut created, &mut exit, &mut kernel, &mut user);
        windows_sys::Win32::Foundation::CloseHandle(h_proc);
        if ok == 0 || exit_code != STILL_ACTIVE {
            return Err("程序启动后立即退出，检测到可能复用了已在后台运行的旧实例；请先完全退出该程序所有旧实例后重新尝试受控接管".into());
        }
        if verified == 0 { return Err("无法核验受控进程的创建时间".into()); }
        Ok((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
    }
}

#[cfg(windows)]
pub fn hook_assets_ready() -> bool {
    hook_dll_path(true).is_ok() && hook_dll_path(false).is_ok()
}

/// Resolves a proxy entry from the effective rule's stable binding.
#[cfg(windows)]
pub fn process_rule_port(
    config: &crate::routing_overrides::model::Overrides,
    rule: &crate::routing_overrides::model::ProcessRule,
) -> Option<u16> {
    match crate::routing_overrides::bundles::owner(&rule.id, &config.bundles) {
        Some(bundle) => (bundle.enabled && bundle.port != 0).then_some(bundle.port),
        None => config.process_ports.get(&rule.id).copied(),
    }
}

#[cfg(all(windows, test))]
fn hook_environment(port: u16, dns: u16, policy: Option<&crate::routing_overrides::model::BundlePolicy>, native_proxy: bool) -> Result<Vec<(std::ffi::OsString, std::ffi::OsString)>, String> {
    hook_environment_with_action(port, dns, policy, native_proxy, None, None)
}

#[cfg(windows)]
fn hook_environment_with_action(port: u16, dns: u16, policy: Option<&crate::routing_overrides::model::BundlePolicy>, native_proxy: bool, action: Option<&str>, session: Option<SessionPolicy<'_>>) -> Result<Vec<(std::ffi::OsString, std::ffi::OsString)>, String> {
    use crate::capture::suite_dns::{self, Mode};
    let default = crate::routing_overrides::model::BundlePolicy::default();
    let p = policy.unwrap_or(&default);
    // Full-edition suite inlets evaluate these settings using the original
    // destination, for both literal addresses and Hook-generated DNS tokens.
    let server_filters = uses_core_listener(port);
    let selected_dns = Mode::for_policy(Some(p));
    let scoped_dns = server_filters && selected_dns != Mode::SystemNative && scoped_dns_inlet(port, selected_dns);
    let dns_mode = effective_dns_mode(server_filters, scoped_dns, selected_dns);
    let native_servers = if server_filters && dns_mode == Mode::SystemNative {
        suite_dns::system_servers().into_iter().map(|ip| ip.to_string()).collect::<Vec<_>>().join(",")
    } else {
        String::new()
    };
    let mut values: std::collections::BTreeMap<String, (std::ffi::OsString, std::ffi::OsString)> = std::env::vars_os()
        .filter(|(k, _)| !k.to_string_lossy().to_ascii_uppercase().starts_with("PROCWEAVER_"))
        .map(|(k, v)| (k.to_string_lossy().to_ascii_uppercase(), (k, v))).collect();
    let mut set = |key: &str, value: String| { values.insert(key.to_ascii_uppercase(), (key.into(), value.into())); };
    for (key, value) in [("PROCWEAVER_BUNDLE_PORT", port.to_string()), ("PROCWEAVER_DNS_PORT", dns.to_string()),
        ("PROCWEAVER_PROXY_TCP", u8::from(p.proxy_tcp).to_string()), ("PROCWEAVER_BLOCK_IPV6", u8::from(p.block_ipv6).to_string()),
        ("PROCWEAVER_BLOCK_UDP", u8::from(p.block_udp).to_string()), ("PROCWEAVER_PROXY_UDP", u8::from(p.proxy_udp).to_string()),
        ("PROCWEAVER_PROXY_SUBPROCESSES", u8::from(p.proxy_subprocesses).to_string()), ("PROCWEAVER_BYPASS_LAN", u8::from(p.bypass_lan).to_string()),
        ("PROCWEAVER_DNS_MODE", dns_mode.as_str().into()),
        ("PROCWEAVER_REMOTE_DNS_REQUIRED", u8::from(server_filters && dns_mode != Mode::SystemNative).to_string()),
        ("PROCWEAVER_CORE_LISTENER", u8::from(server_filters).to_string()),
        ("PROCWEAVER_SCOPED_DNS", u8::from(scoped_dns).to_string()),
        ("PROCWEAVER_NATIVE_DNS_SERVERS", native_servers),
        ("PROCWEAVER_PORT_FILTER_MODE", if server_filters { "all".into() } else { p.port_filter_mode.clone() }),
        ("PROCWEAVER_CUSTOM_PORTS", if server_filters { String::new() } else { p.custom_ports.clone() }),
        ("PROCWEAVER_TARGET_FILTER_MODE", if server_filters { "all".into() } else { p.target_filter_mode.clone() }),
        ("PROCWEAVER_TARGET_RULES", if server_filters { String::new() } else { p.target_rules.join(",") })] { set(key, value); }
    if let Some(act) = action {
        set("PROCWEAVER_ACTION", act.to_ascii_uppercase());
    }
    if session.is_some() {
        set("PROCWEAVER_POLICY_RESOLVED", "1".into());
    }
    let mixed_port = if crate::storage::is_initialized() {
        crate::commands::settings::get_general_settings().map(|s| s.mixed_port).unwrap_or(7890)
    } else {
        7890
    };
    let managed_ports = crate::capture::local_proxy::managed_endpoints_with_port(Some(mixed_port))
        .into_iter().map(|a| a.port().to_string()).collect::<Vec<_>>().join(",");
    set("PROCWEAVER_SYSTEM_PROXY_PORTS", managed_ports);

    if let Some(config) = (crate::function_mode::core_features_enabled() && session.is_none_or(|policy| !policy.external))
        .then(crate::routing_overrides::read).transpose()? {
        let config = config.effective();
        let mut override_rules = Vec::new();
        // 第一优先级：收集明确规则（path 类型先行，name 类型随后，附带显式 path:/name: 前缀防止后缀与路径碰撞）
        if config.process_enabled {
            for kind in ["path", "name"] {
                for r in config.process_rules.iter().filter(|r| r.enabled && r.match_kind == kind) {
                    if crate::routing_overrides::bundles::owner(&r.id, &config.bundles).is_some_and(|b| !b.enabled) {
                        continue;
                    }
                    let rule_act = match r.action.as_str() {
                        "direct" => "DIRECT".to_string(),
                        "reject" => "REJECT".to_string(),
                        _ if r.target.as_ref().is_some_and(|t| t.name.eq_ignore_ascii_case("DIRECT")) => "DIRECT".to_string(),
                        _ => process_rule_port(&config, r).ok_or("进程规则入口未分配")?.to_string(),
                    };
                    override_rules.push(format!("{kind}:{}={rule_act}", r.match_value.trim().to_ascii_lowercase()));
                }
            }
        }
        if config.bundles_enabled {
            for b in &config.bundles {
                if !b.enabled || b.port == 0 { continue; }
                let main_path = b.main_exe.trim();
                if std::path::Path::new(main_path).is_absolute() {
                    override_rules.push(format!("path:{}={}", main_path.to_ascii_lowercase(), b.port));
                }
                let name = std::path::Path::new(main_path).file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_else(|| main_path.to_ascii_lowercase());
                override_rules.push(format!("name:{name}={}", b.port));
            }
        }
        set("PROCWEAVER_OVERRIDE_RULES", override_rules.join(";"));
    }
    let reject = action == Some("REJECT");
    if port != 0 || reject {
        set("PROCWEAVER_HOOK_CONTROL", control::create(port, session, reject)?);
        set("PROCWEAVER_HOOK_HOST_PID", std::process::id().to_string());
    }
    if native_proxy {
        for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] { set(key, format!("http://127.0.0.1:{port}")); }
        set("NO_PROXY", "localhost,127.0.0.1,::1".into()); set("NODE_USE_ENV_PROXY", "1".into());
    }
    Ok(values.into_values().collect())
}

#[cfg(windows)]
fn uses_core_listener(port: u16) -> bool {
    port != 0 && !crate::edition::PROCESS && crate::function_mode::core_features_enabled()
        && !crate::external_proxy::routes().iter().any(|route| route.port == port)
}

#[cfg(windows)]
fn effective_dns_mode(
    core_listener: bool, scoped: bool, selected: crate::capture::suite_dns::Mode,
) -> crate::capture::suite_dns::Mode {
    use crate::capture::suite_dns::Mode;
    // Standalone process rules have no suite resolver. Keep their existing protected tokens.
    if core_listener && !scoped && selected == Mode::SafePure { Mode::FakeIp } else { selected }
}

#[cfg(windows)]
fn scoped_dns_inlet(port: u16, mode: crate::capture::suite_dns::Mode) -> bool {
    if !crate::storage::is_initialized() { return false; }
    let path = crate::storage::data_dir().join("core_data/config.yaml");
    let Ok(raw) = std::fs::read_to_string(path) else { return false; };
    let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(&raw) else { return false; };
    let rule = yaml["listeners"].as_sequence().into_iter().flatten().find_map(|listener| {
        (listener["port"].as_u64() == Some(u64::from(port)) && listener["listen"].as_str() == Some("127.0.0.1"))
            .then(|| listener["rule"].as_str()).flatten()
    });
    rule.is_some_and(|rule| yaml[crate::routing_overrides::bundles::SANDBOX_DNS].as_sequence().into_iter()
        .flatten().any(|scope| scope["mode"].as_str() == Some(mode.as_str())
            && scope["rules"].as_sequence().into_iter().flatten().any(|name| name.as_str() == Some(rule))))
}

#[cfg(windows)]
fn environment_block(values: &[(std::ffi::OsString, std::ffi::OsString)]) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    let mut block = Vec::new();
    for (key, value) in values { block.extend(key.encode_wide()); block.push(b'=' as u16); block.extend(value.encode_wide()); block.push(0); }
    block.push(0); block
}

#[cfg(windows)]
fn launch_with_remote_thread_fallback(
    exe: &Path,
    args: &[String],
    working_dir: Option<&Path>,
    dll_path: &Path,
    environment: &[(std::ffi::OsString, std::ffi::OsString)],
) -> Result<u32, String> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FALSE},
        System::{
            LibraryLoader::{GetModuleHandleA, GetProcAddress},
            Threading::{
                CreateRemoteThread, GetExitCodeThread, ResumeThread, WaitForSingleObject,
                CREATE_SUSPENDED,
            },
        },
    };

    const MEM_COMMIT: u32 = 0x00001000;
    const MEM_RESERVE: u32 = 0x00002000;
    const MEM_RELEASE: u32 = 0x00008000;
    const PAGE_READWRITE: u32 = 0x04;

    #[link(name = "kernel32")]
    extern "system" {
        fn VirtualAllocEx(
            hProcess: windows_sys::Win32::Foundation::HANDLE,
            lpAddress: *mut std::ffi::c_void,
            dwSize: usize,
            flAllocationType: u32,
            flProtect: u32,
        ) -> *mut std::ffi::c_void;

        fn VirtualFreeEx(
            hProcess: windows_sys::Win32::Foundation::HANDLE,
            lpAddress: *mut std::ffi::c_void,
            dwSize: usize,
            dwFreeType: u32,
        ) -> windows_sys::Win32::Foundation::BOOL;

        fn WriteProcessMemory(
            hProcess: windows_sys::Win32::Foundation::HANDLE,
            lpBaseAddress: *mut std::ffi::c_void,
            lpBuffer: *const std::ffi::c_void,
            nSize: usize,
            lpNumberOfBytesWritten: *mut usize,
        ) -> windows_sys::Win32::Foundation::BOOL;
    }

    let dll_path_wide: Vec<u16> = dll_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    let mut command = std::process::Command::new(exe);
    command.args(args);
    command.creation_flags(CREATE_SUSPENDED);
    command.env_clear().envs(environment.iter().map(|(k, v)| (k, v)));

    if let Some(dir) = working_dir {
        command.current_dir(dir);
    } else if let Some(parent) = exe.parent() {
        command.current_dir(parent);
    }

    let child = command.spawn().map_err(|e| format!("挂起启动目标程序失败: {e}"))?;
    let pid = child.id();

    unsafe {
        use std::os::windows::io::AsRawHandle;
        let process_handle = child.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
        let _ = crate::commands::windows_integration::assign_to_job_object(process_handle);

        let kernel32 = GetModuleHandleA(b"kernel32.dll\0".as_ptr());
        if kernel32.is_null() {
            return Err("无法定位 kernel32.dll".into());
        }

        let load_library_w = GetProcAddress(kernel32, b"LoadLibraryW\0".as_ptr());
        if load_library_w.is_none() {
            return Err("无法获取 LoadLibraryW 地址".into());
        }

        let path_bytes_len = dll_path_wide.len() * std::mem::size_of::<u16>();
        let remote_mem = VirtualAllocEx(
            process_handle,
            std::ptr::null_mut(),
            path_bytes_len,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        );

        if remote_mem.is_null() {
            return Err("在目标进程中分配内存失败".into());
        }

        let mut written = 0;
        let write_ok = WriteProcessMemory(
            process_handle,
            remote_mem,
            dll_path_wide.as_ptr() as *const _,
            path_bytes_len,
            &mut written,
        );

        if write_ok == FALSE || written != path_bytes_len {
            VirtualFreeEx(process_handle, remote_mem, 0, MEM_RELEASE);
            return Err("向目标进程写入 Hook 路径失败".into());
        }

        let thread_handle = CreateRemoteThread(
            process_handle,
            std::ptr::null(),
            0,
            std::mem::transmute(load_library_w),
            remote_mem,
            0,
            std::ptr::null_mut(),
        );

        if thread_handle.is_null() {
            VirtualFreeEx(process_handle, remote_mem, 0, MEM_RELEASE);
            return Err("在目标进程中创建远程线程注入失败".into());
        }

        let wait_res = WaitForSingleObject(thread_handle, 5000);
        let mut exit_code = 0;
        if wait_res == 0 {
            GetExitCodeThread(thread_handle, &mut exit_code);
        }
        CloseHandle(thread_handle);
        VirtualFreeEx(process_handle, remote_mem, 0, MEM_RELEASE);

        let thread_id = get_process_main_thread_id(pid);
        if let Some(tid) = thread_id {
            use windows_sys::Win32::System::Threading::{OpenThread, THREAD_SUSPEND_RESUME};
            let h_thread = OpenThread(THREAD_SUSPEND_RESUME, FALSE, tid);
            if !h_thread.is_null() {
                ResumeThread(h_thread);
                CloseHandle(h_thread);
            }
        }
    }

    Ok(pid)
}

#[cfg(windows)]
fn get_process_main_thread_id(pid: u32) -> Option<u32> {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }

        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            cntUsage: 0,
            th32ThreadID: 0,
            th32OwnerProcessID: 0,
            tpBasePri: 0,
            tpDeltaPri: 0,
            dwFlags: 0,
        };

        let mut target_tid = None;
        if Thread32First(snapshot, &mut entry) != 0 {
            loop {
                if entry.th32OwnerProcessID == pid {
                    target_tid = Some(entry.th32ThreadID);
                    break;
                }
                if Thread32Next(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        target_tid
    }
}

#[cfg(not(windows))]
pub fn launch_with_hook(
    _exe: &Path,
    _args: &[String],
    _working_dir: Option<&Path>,
    _bundle_port: u16,
    _dns_port: u16,
) -> Result<u32, String> {
    Err("用户态 Hook 注入仅支持 Windows 平台".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn business_dns_preserves_names_without_public_resolution() {
        use crate::capture::suite_dns::Mode;
        for mode in [Mode::SafePure, Mode::FakeIp, Mode::SystemNative] {
            assert_eq!(effective_dns_mode(true, true, mode), mode);
            assert_eq!(effective_dns_mode(false, false, mode), mode);
        }
        assert_eq!(effective_dns_mode(true, false, Mode::SafePure), Mode::FakeIp);
        assert_eq!(effective_dns_mode(true, false, Mode::SystemNative), Mode::SystemNative);
    }

    #[test]
    fn test_pe_bitness_detection() {
        if let Ok(exe) = std::env::current_exe() {
            let is_64 = is_executable_64bit(&exe).unwrap();
            #[cfg(target_pointer_width = "64")]
            assert!(is_64);
            #[cfg(target_pointer_width = "32")]
            assert!(!is_64);
        }
    }

    #[test]
    fn test_hook_dll_discovery() {
        let path64 = hook_dll_path(true);
        assert!(path64.is_ok(), "Hook 64-bit DLL 应能被找到: {:?}", path64);
        let path32 = hook_dll_path(false);
        assert!(path32.is_ok(), "Hook 32-bit DLL 应能被找到: {:?}", path32);
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires freshly built x64/x86 Hook and native fixture"]
    fn native_business_names_reach_outlet_without_public_dns() {
        if crate::edition::PROCESS { return; }
        use std::io::{Read, Write};
        use std::time::{Duration, Instant};
        use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
        use std::os::windows::process::CommandExt;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let dns = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        dns.set_nonblocking(true).unwrap();
        let mut values = hook_environment(port, dns.local_addr().unwrap().port(), None, false).unwrap();
        // The DLL must enforce the invariant even with inconsistent legacy input.
        values.iter_mut().find(|(key, _)| key == "PROCWEAVER_DNS_MODE").unwrap().1 = "system_native".into();
        let name = values.iter().find(|(k, _)| k == "PROCWEAVER_HOOK_CONTROL").unwrap().1.to_string_lossy().into_owned();
        let done = Arc::new(AtomicBool::new(false));
        let finished = done.clone();
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            let deadline = Instant::now() + Duration::from_secs(12);
            while !finished.load(Ordering::SeqCst) && Instant::now() < deadline {
                let Ok((mut stream, _)) = listener.accept() else { std::thread::sleep(Duration::from_millis(5)); continue; };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut auth = [0; 3]; if stream.read_exact(&mut auth).is_err() { continue; }
                assert_eq!(auth, [5, 1, 0]); stream.write_all(&[5, 0]).unwrap();
                let mut header = [0; 5];
                // Unknown Fake-IP may open the loopback socket, but must not send CONNECT.
                if stream.read_exact(&mut header).is_err() { continue; }
                assert_eq!(&header[..4], &[5, 1, 0, 3]);
                let mut host = vec![0; header[4] as usize]; stream.read_exact(&mut host).unwrap();
                let mut target_port = [0; 2]; stream.read_exact(&mut target_port).unwrap();
                requests.push((String::from_utf8(host).unwrap(), u16::from_be_bytes(target_port)));
                stream.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0]).unwrap();
            }
            requests
        });
        let mut child = std::process::Command::new(std::env::var_os("PROCWEAVER_TEST_HOOK_FIXTURE").unwrap())
            .arg(std::env::var_os("PROCWEAVER_TEST_HOOK_DLL").unwrap()).arg("remote-dns")
            .env_clear().envs(values).creation_flags(0x08000000).spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        let result = loop {
            if let Some(status) = child.try_wait().unwrap() { break status; }
            if Instant::now() > deadline { let _ = child.kill(); break child.wait().unwrap(); }
            std::thread::sleep(Duration::from_millis(10));
        };
        done.store(true, Ordering::SeqCst);
        let requests = server.join().unwrap();
        control::revoke(&name);
        assert!(result.success(), "native fixture: {result}, requests: {requests:?}");
        let expected = [("a.remote-dns.invalid".into(), 443), ("w.remote-dns.invalid".into(), 8443),
            ("legacy.remote-dns.invalid".into(), 9443), ("ex-a.remote-dns.invalid".into(), 443), ("ex-w.remote-dns.invalid".into(), 443)];
        let expected: Vec<_> = expected.iter().cycle().take(10).cloned().collect();
        assert_eq!(requests, expected, "自定义子进程环境也必须继承业务域名透传，且保留应用变量");
        let mut query = [0; 512];
        assert_eq!(dns.recv_from(&mut query).unwrap_err().kind(), std::io::ErrorKind::WouldBlock, "业务不得查询配置的公共 DNS 端口");
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires freshly built Hook DLL and the isolated native fixture"]
    fn native_hook_withdrawal_restores_original_socket_behavior() {
        if crate::edition::PROCESS { return; }
        use std::io::{BufRead, Write};
        use std::process::Stdio;
        let fixture = std::env::var_os("PROCWEAVER_TEST_HOOK_FIXTURE").expect("native fixture path");
        let dll = std::env::var_os("PROCWEAVER_TEST_HOOK_DLL").expect("fresh Hook DLL path");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let before = std::env::var_os("HTTP_PROXY");
        let values = hook_environment(34998, 45053, None, false).unwrap();
        assert_eq!(std::env::var_os("HTTP_PROXY"), before, "启动配置不得污染宿主环境");
        let child = std::process::Command::new(&fixture).arg(&dll).arg(listener.local_addr().unwrap().port().to_string())
            .env_clear().envs(values).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        struct Child(std::process::Child);
        impl Drop for Child { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }
        let mut child = Child(child);
        let stdout = child.0.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || { for line in std::io::BufReader::new(stdout).lines() { if tx.send(line.unwrap()).is_err() { break; } } });
        assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap(), "blocked");
        control::stop();
        child.0.stdin.as_mut().unwrap().write_all(b"continue\n").unwrap();
        assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap(), "native");
        assert!(child.0.wait().unwrap().success());
        reader.join().unwrap();
        // Exercise the real cross-bitness launcher and its explicit environment,
        // not only a DLL loaded by the fixture itself.
        let report = std::env::temp_dir().join(format!("pw-hook-launch-{}.txt", std::process::id()));
        let args = vec![dll.to_string_lossy().into_owned(), listener.local_addr().unwrap().port().to_string(), report.to_string_lossy().into_owned()];
        let pid = launch_with_hook(Path::new(&fixture), &args, None, 34998, 45053, None, false).unwrap();
        use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::{OpenProcess, TerminateProcess, WaitForSingleObject}};
        let handle = unsafe { OpenProcess(0x00100001, 0, pid) };
        assert!(!handle.is_null());
        struct NativeProcess(windows_sys::Win32::Foundation::HANDLE);
        impl Drop for NativeProcess { fn drop(&mut self) { unsafe { if WaitForSingleObject(self.0, 0) == 258 { TerminateProcess(self.0, 1); } CloseHandle(self.0); } } }
        let native = NativeProcess(handle);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::fs::read_to_string(&report).unwrap_or_default().trim() != "blocked" {
            assert!(std::time::Instant::now() < deadline, "新启动器未传递 Hook 策略或启动失败");
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        control::stop();
        assert_eq!(unsafe { WaitForSingleObject(native.0, 10000) }, 0);
        assert_eq!(std::fs::read_to_string(&report).unwrap().lines().collect::<Vec<_>>(), ["blocked", "native"]);
        assert_eq!(std::env::var_os("HTTP_PROXY"), before);
        std::fs::remove_file(report).unwrap();
    }
}
