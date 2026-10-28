//! 用户态强接管（免驱动 · 注入 Hook · 路线 B 真实 DNS 解析）
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

pub const MODE: &str = "user_mode";

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
    lpPid: *mut u32,
) -> windows_sys::Win32::Foundation::BOOL;

#[cfg(windows)]
pub fn launch_with_hook(
    exe: &Path,
    args: &[String],
    working_dir: Option<&Path>,
    bundle_port: u16,
    dns_port: u16,
    policy: Option<&crate::routing_overrides::model::BundlePolicy>,
) -> Result<u32, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    let is_64bit = is_executable_64bit(exe)?;
    let target_dll = hook_dll_path(is_64bit)?;

    if let Some(parent) = target_dll.parent() {
        ensure_hook_dir_acl(parent);
    }

    // 预设环境变量供子进程自然继承
    std::env::set_var("PROCWEAVER_BUNDLE_PORT", bundle_port.to_string());
    std::env::set_var("PROCWEAVER_DNS_PORT", dns_port.to_string());

    let default_policy = crate::routing_overrides::model::BundlePolicy::default();
    let pol = policy.unwrap_or(&default_policy);

    std::env::set_var("PROCWEAVER_PROXY_TCP", if pol.proxy_tcp { "1" } else { "0" });
    std::env::set_var("PROCWEAVER_BLOCK_IPV6", if pol.block_ipv6 { "1" } else { "0" });
    std::env::set_var("PROCWEAVER_BLOCK_UDP", if pol.block_udp { "1" } else { "0" });
    std::env::set_var("PROCWEAVER_PROXY_UDP", if pol.proxy_udp { "1" } else { "0" });
    std::env::set_var("PROCWEAVER_PROXY_SUBPROCESSES", if pol.proxy_subprocesses { "1" } else { "0" });
    std::env::set_var("PROCWEAVER_BYPASS_LAN", if pol.bypass_lan { "1" } else { "0" });
    std::env::set_var("PROCWEAVER_DNS_MODE", &pol.dns_mode);
    std::env::set_var("PROCWEAVER_PORT_FILTER_MODE", &pol.port_filter_mode);
    std::env::set_var("PROCWEAVER_CUSTOM_PORTS", &pol.custom_ports);
    std::env::set_var("PROCWEAVER_TARGET_FILTER_MODE", &pol.target_filter_mode);
    std::env::set_var("PROCWEAVER_TARGET_RULES", pol.target_rules.join(","));

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
            let proc_addr = GetProcAddress(h_launcher, b"PwLaunchProcess\0".as_ptr());
            if let Some(fn_ptr) = proc_addr {
                let pfn: PfnPwLaunchProcess = std::mem::transmute(fn_ptr);
                let mut pid: u32 = 0;
                let ok = pfn(
                    exe_wide.as_ptr(),
                    cmd_wide.as_mut_ptr(),
                    dir_wide.as_ref().map_or(std::ptr::null(), |v| v.as_ptr()),
                    dll_path_ansi.as_ptr() as *const u8,
                    &mut pid,
                );
                if ok != 0 && pid != 0 {
                    return Ok(pid);
                }
            }
        }
    }

    // Fallback：挂起远程线程方式
    launch_with_remote_thread_fallback(exe, args, working_dir, bundle_port, dns_port, &target_dll, policy)
}

#[cfg(windows)]
fn launch_with_remote_thread_fallback(
    exe: &Path,
    args: &[String],
    working_dir: Option<&Path>,
    bundle_port: u16,
    dns_port: u16,
    dll_path: &Path,
    policy: Option<&crate::routing_overrides::model::BundlePolicy>,
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
    command.env("PROCWEAVER_BUNDLE_PORT", bundle_port.to_string());
    command.env("PROCWEAVER_DNS_PORT", dns_port.to_string());

    let default_policy = crate::routing_overrides::model::BundlePolicy::default();
    let pol = policy.unwrap_or(&default_policy);
    command.env("PROCWEAVER_PROXY_TCP", if pol.proxy_tcp { "1" } else { "0" });
    command.env("PROCWEAVER_BLOCK_IPV6", if pol.block_ipv6 { "1" } else { "0" });
    command.env("PROCWEAVER_BLOCK_UDP", if pol.block_udp { "1" } else { "0" });
    command.env("PROCWEAVER_PROXY_UDP", if pol.proxy_udp { "1" } else { "0" });
    command.env("PROCWEAVER_PROXY_SUBPROCESSES", if pol.proxy_subprocesses { "1" } else { "0" });
    command.env("PROCWEAVER_BYPASS_LAN", if pol.bypass_lan { "1" } else { "0" });
    command.env("PROCWEAVER_DNS_MODE", &pol.dns_mode);
    command.env("PROCWEAVER_PORT_FILTER_MODE", &pol.port_filter_mode);
    command.env("PROCWEAVER_CUSTOM_PORTS", &pol.custom_ports);
    command.env("PROCWEAVER_TARGET_FILTER_MODE", &pol.target_filter_mode);
    command.env("PROCWEAVER_TARGET_RULES", pol.target_rules.join(","));

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
}
