//! Native shortcut and command-line operations; never evaluate arguments as shell code.
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Link {
    pub target: String, pub arguments: String, pub directory: String,
    pub icon: String, pub icon_index: i32, pub description: String,
}
#[cfg(windows)]
pub(super) fn com<T>(action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    use windows::Win32::System::Com::*;
    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    // A caller may already own an STA. ShellLink also works in that apartment.
    if initialized.is_err() && initialized.0 != 0x80010106u32 as i32 { return Err("初始化 Windows 原生接口失败".into()); }
    struct Apartment(bool);
    impl Drop for Apartment { fn drop(&mut self) { if self.0 { unsafe { CoUninitialize(); } } } }
    let _apartment = Apartment(initialized.is_ok());
    action()
}
#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }
#[cfg(windows)]
fn string(value: &[u16]) -> String { String::from_utf16_lossy(&value[..value.iter().position(|c| *c == 0).unwrap_or(value.len())]) }

pub fn desktop(public: bool) -> Result<PathBuf, String> {
    #[cfg(windows)] { com(|| unsafe {
        use windows::Win32::{UI::Shell::*, System::Com::CoTaskMemFree};
        let pointer = SHGetKnownFolderPath(if public { &FOLDERID_PublicDesktop } else { &FOLDERID_Desktop }, KNOWN_FOLDER_FLAG(0), None).map_err(|_| "无法定位实际桌面目录")?;
        let result = pointer.to_string().map(PathBuf::from).map_err(|_| "桌面路径无效".to_string());
        CoTaskMemFree(Some(pointer.0.cast())); result
    }) }
    #[cfg(not(windows))] { let _ = public; Err("快捷方式仅支持 Windows".into()) }
}
pub fn read_link(path: &Path) -> Result<Link, String> {
    #[cfg(windows)] { com(|| unsafe {
        use windows::{core::{Interface, PCWSTR}, Win32::{System::Com::*, UI::Shell::*}};
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|_| "创建快捷方式接口失败")?;
        let file: IPersistFile = link.cast().map_err(|_| "读取快捷方式接口失败")?;
        file.Load(PCWSTR(wide(&path.to_string_lossy()).as_ptr()), STGM_READ).map_err(|_| "无法读取快捷方式")?;
        let mut buffer = vec![0; 32768];
        link.GetPath(&mut buffer, std::ptr::null_mut(), 0).map_err(|_| "无法读取快捷方式目标")?; let target = string(&buffer);
        buffer.fill(0); link.GetArguments(&mut buffer).map_err(|_| "无法读取快捷方式参数")?; let arguments = string(&buffer);
        buffer.fill(0); link.GetWorkingDirectory(&mut buffer).map_err(|_| "无法读取工作目录")?; let directory = string(&buffer);
        buffer.fill(0); link.GetDescription(&mut buffer).map_err(|_| "无法读取快捷方式说明")?; let description = string(&buffer);
        let mut icon_index = 0; buffer.fill(0); link.GetIconLocation(&mut buffer, &mut icon_index).map_err(|_| "无法读取图标")?;
        Ok(Link { target, arguments, directory, description, icon: string(&buffer), icon_index })
    }) }
    #[cfg(not(windows))] { let _ = path; Err("快捷方式仅支持 Windows".into()) }
}
pub fn write_link(path: &Path, value: &Link, preserve: bool) -> Result<(), String> {
    #[cfg(windows)] { com(|| unsafe {
        use windows::{core::{Interface, PCWSTR}, Win32::{System::Com::*, UI::Shell::*}};
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|_| "创建快捷方式接口失败")?;
        let file: IPersistFile = link.cast().map_err(|_| "读取快捷方式接口失败")?;
        let filename = wide(&path.to_string_lossy());
        if preserve { file.Load(PCWSTR(filename.as_ptr()), STGM_READWRITE).map_err(|_| "无法读取原快捷方式，未修改")?; }
        link.SetPath(PCWSTR(wide(&value.target).as_ptr())).map_err(|_| "设置快捷方式目标失败")?;
        link.SetArguments(PCWSTR(wide(&value.arguments).as_ptr())).map_err(|_| "设置快捷方式参数失败")?;
        link.SetWorkingDirectory(PCWSTR(wide(&value.directory).as_ptr())).map_err(|_| "设置快捷方式目录失败")?;
        link.SetDescription(PCWSTR(wide(&value.description).as_ptr())).map_err(|_| "设置快捷方式说明失败")?;
        link.SetIconLocation(PCWSTR(wide(&value.icon).as_ptr()), value.icon_index).map_err(|_| "设置快捷方式图标失败")?;
        file.Save(PCWSTR(filename.as_ptr()), true).map_err(|_| "保存快捷方式失败，请检查目录写入权限".to_string())
    }) }
    #[cfg(not(windows))] { let _ = (path,value,preserve); Err("快捷方式仅支持 Windows".into()) }
}

pub fn split_arguments(command: &str) -> Result<Vec<String>, String> {
    #[cfg(windows)] unsafe {
        use windows::{core::PCWSTR, Win32::{UI::Shell::CommandLineToArgvW, Foundation::{HLOCAL, LocalFree}}};
        let mut count = 0;
        let pointer = CommandLineToArgvW(PCWSTR(wide(command).as_ptr()), &mut count);
        if pointer.is_null() { return Err("无法解析应用参数".into()); }
        let result = std::slice::from_raw_parts(pointer, count as usize).iter().map(|p| p.to_string().unwrap_or_default()).collect();
        let _ = LocalFree(Some(HLOCAL(pointer.cast()))); Ok(result)
    }
    #[cfg(target_os = "macos")] { serde_json::from_str(command).map_err(|_| "macOS 应用参数格式无效".into()) }
    #[cfg(not(any(windows, target_os = "macos")))] { let _ = command; Err("当前系统不支持应用参数读取".into()) }
}

// Limit WMI reads to the selected executable name. Command lines stay in memory.
pub fn command_lines(name: &str) -> Result<Vec<(u32, String)>, String> {
    Ok(process_command_lines(&[name])?.into_iter().map(|row| (row.pid, row.command)).collect())
}
pub struct ProcessCommand { pub pid: u32, pub name: String, pub command: String }
pub fn process_command_lines(names: &[&str]) -> Result<Vec<ProcessCommand>, String> {
    if names.is_empty() { return Ok(vec![]); }
    if names.len() > 128 || names.iter().any(|name| name.is_empty() || name.contains(['\'', '"', '\\', '/'])) { return Err("应用文件名无效".into()); }
    let filter = names.iter().map(|name| format!("Name='{name}'")).collect::<Vec<_>>().join(" OR ");
    #[cfg(windows)] { com(|| unsafe {
        use windows::{core::{BSTR,w}, Win32::System::{Com::*, Wmi::*, Variant::*}};
        let locator: IWbemLocator = CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER).map_err(|_| "创建进程查询失败")?;
        let empty = BSTR::new();
        let service = locator.ConnectServer(&BSTR::from("ROOT\\CIMV2"), &empty,&empty,&empty,0,&empty,None).map_err(|_| "连接进程查询失败")?;
        CoSetProxyBlanket(&service,10,0,None,RPC_C_AUTHN_LEVEL_CALL,RPC_C_IMP_LEVEL_IMPERSONATE,None,EOAC_NONE).map_err(|_| "设置进程查询权限失败")?;
        let rows = service.ExecQuery(&BSTR::from("WQL"), &BSTR::from(format!("SELECT ProcessId,Name,CommandLine FROM Win32_Process WHERE {filter}")), WBEM_FLAG_RETURN_IMMEDIATELY|WBEM_FLAG_FORWARD_ONLY, None).map_err(|_| "查询应用进程失败")?;
        let mut result = Vec::new();
        let started = std::time::Instant::now();
        let mut buffer = vec![0;32768];
        loop {
            if started.elapsed() > std::time::Duration::from_secs(3) { return Err("查询应用进程超时".into()); }
            let mut objects = [None]; let mut count = 0;
            let status = rows.Next(1500, &mut objects, &mut count);
            if status.0 == WBEM_S_TIMEDOUT.0 { return Err("查询应用进程超时".into()); }
            status.ok().map_err(|error| format!("读取应用进程失败（WMI 0x{:08X}）", error.code().0 as u32))?;
            if count == 0 { break; }
            let object = objects[0].as_ref().ok_or("应用进程查询无效")?;
            let mut value = VARIANT::default(); object.Get(w!("ProcessId"),0,&mut value,None,None).map_err(|_| "进程身份不可读")?;
            let pid = VariantToUInt32(&value).map_err(|_| "进程身份无效")?;
            let mut value = VARIANT::default(); object.Get(w!("Name"),0,&mut value,None,None).map_err(|_| "进程名称不可读")?;
            buffer.fill(0);
            let name = if VariantToString(&value, &mut buffer).is_ok() { string(&buffer) } else { String::new() };
            let mut value = VARIANT::default(); object.Get(w!("CommandLine"),0,&mut value,None,None).map_err(|_| "进程参数不可读")?;
            buffer.fill(0);
            let command = if VariantToString(&value, &mut buffer).is_ok() { string(&buffer) } else { String::new() };
            result.push(ProcessCommand { pid, name, command });
            if result.len() > 2048 { return Err("应用进程过多，无法安全核对".into()); }
        } Ok(result)
    }) }
    #[cfg(target_os = "macos")] {
        let _ = filter;
        let mut result = Vec::new();
        for entry in crate::routing_overrides::native::snapshot()? {
            if !names.iter().any(|name| *name == entry.name) { continue; }
            let args = crate::platform::macos::processes::arguments(entry.pid)?;
            if crate::routing_overrides::native::inspect(entry.pid, 0, entry.name.clone()).identity != entry.identity {
                return Err("应用实例已改变，请重新检测".into());
            }
            result.push(ProcessCommand { pid: entry.pid, name: entry.name, command: serde_json::to_string(&args).map_err(|_| "应用参数无效")? });
        }
        Ok(result)
    }
    #[cfg(not(any(windows, target_os = "macos")))] { let _ = filter; Err("当前系统不支持进程查询".into()) }
}

#[cfg(all(test, windows))]
mod performance_tests {
    #[test]
    fn performance_native_command_query_batches_names_without_shell() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        let mut last_err = None;
        let mut rows = None;
        for _ in 0..5 {
            match super::process_command_lines(&[name, "procweaver-absent-test.exe"]) {
                Ok(r) => { rows = Some(r); break; }
                Err(e) => {
                    last_err = Some(e);
                    std::thread::sleep(std::time::Duration::from_millis(300));
                }
            }
        }
        let rows = rows.unwrap_or_else(|| panic!("process_command_lines failed: {:?}", last_err));
        let own = rows.iter().find(|row| row.pid == std::process::id()).unwrap();
        assert_eq!(own.name.to_lowercase(), name.to_lowercase());
        assert!(!own.command.is_empty());
        assert!(super::process_command_lines(&["a' OR 1=1"]).is_err());
    }
}

pub fn request_close(pid: u32, identity: &str) -> Result<(), String> {
    #[cfg(windows)] unsafe {
        use windows_sys::Win32::{Foundation::*, System::Threading::*, UI::WindowsAndMessaging::*};
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE, 0, pid);
        if handle.is_null() { return Err("无法核实待重启进程，请手动正常退出".into()); }
        struct Handle(HANDLE); impl Drop for Handle { fn drop(&mut self) { unsafe { CloseHandle(self.0); } } }
        let _guard = Handle(handle);
        let mut c:FILETIME=std::mem::zeroed(); let mut e=c; let mut k=c; let mut u=c;
        if GetProcessTimes(handle,&mut c,&mut e,&mut k,&mut u)==0 || format!("{pid}:{}",((c.dwHighDateTime as u64)<<32)|c.dwLowDateTime as u64)!=identity { return Err("应用实例已改变，请重新检测".into()); }
        unsafe extern "system" fn close(window: HWND, data: LPARAM) -> BOOL {
            let mut owner = 0; GetWindowThreadProcessId(window, &mut owner);
            if owner == data as u32 && IsWindowVisible(window) != 0 { let _ = PostMessageW(window,WM_CLOSE,0,0); } 1
        }
        if WaitForSingleObject(handle,0) == WAIT_TIMEOUT { let _ = EnumWindows(Some(close), pid as LPARAM); }
        Ok(())
    }
    #[cfg(target_os = "macos")] { crate::platform::macos::processes::request_close(pid, identity) }
    #[cfg(not(any(windows, target_os = "macos")))] { let _=(pid,identity); Err("当前系统不支持请求应用退出".into()) }
}

#[cfg(windows)]
pub fn assign_to_job_object(process_handle: windows_sys::Win32::Foundation::HANDLE) -> bool {
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
    };

    struct SafeJob(HANDLE);
    unsafe impl Send for SafeJob {}
    unsafe impl Sync for SafeJob {}
    impl Drop for SafeJob {
        fn drop(&mut self) {
            if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(self.0); }
            }
        }
    }
    static ACTIVE_JOBS: Mutex<Vec<SafeJob>> = Mutex::new(Vec::new());

    if process_handle.is_null() || process_handle == INVALID_HANDLE_VALUE {
        return false;
    }

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() || job == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            CloseHandle(job);
            return false;
        }
        if AssignProcessToJobObject(job, process_handle) == 0 {
            CloseHandle(job);
            return false;
        }
        if let Ok(mut lock) = ACTIVE_JOBS.lock() {
            lock.push(SafeJob(job));
        }
        true
    }
}

#[cfg(not(windows))]
pub fn assign_to_job_object(_process_handle: *mut std::ffi::c_void) -> bool {
    false
}

#[cfg(windows)]
extern "system" {
    fn OpenFileMappingW(dwDesiredAccess: u32, bInheritHandle: i32, lpName: *const u16) -> *mut std::ffi::c_void;
    fn MapViewOfFile(hFileMappingObject: *mut std::ffi::c_void, dwDesiredAccess: u32, dwFileOffsetHigh: u32, dwFileOffsetLow: u32, dwNumberOfBytesToMap: usize) -> *mut std::ffi::c_void;
    fn UnmapViewOfFile(lpBaseAddress: *const std::ffi::c_void) -> i32;
}

#[cfg(windows)]
pub fn read_hook_tiers() -> std::collections::HashMap<u32, (u32, String)> {
    use std::collections::HashMap;
    use windows_sys::Win32::Foundation::CloseHandle;

    let mut map = HashMap::new();
    let name: Vec<u16> = "Local\\ProcWeaver_Hook_Tiers\0".encode_utf16().collect();
    unsafe {
        let handle = OpenFileMappingW(4, 0, name.as_ptr()); // FILE_MAP_READ = 4
        if handle.is_null() {
            return map;
        }
        let ptr = MapViewOfFile(handle, 4, 0, 0, 0);
        if !ptr.is_null() {
            let magic = *(ptr as *const u32);
            if magic == 0x5057484B { // "PWHK"
                let count = *((ptr as *const u8).add(4) as *const u32);
                let records_ptr = (ptr as *const u8).add(8);
                let record_size = 84usize;
                for i in 0..(count.min(256) as usize) {
                    let rec = records_ptr.add(i * record_size);
                    let pid = *(rec as *const u32);
                    let tier = *((rec.add(4)) as *const u32);
                    let name_bytes = std::slice::from_raw_parts(rec.add(8), 64);
                    let name_len = name_bytes.iter().position(|&b| b == 0).unwrap_or(64);
                    let proc_name = String::from_utf8_lossy(&name_bytes[..name_len]).to_string();
                    map.insert(pid, (tier, proc_name));
                }
            }
            UnmapViewOfFile(ptr);
        }
        CloseHandle(handle as _);
    }
    map
}

#[cfg(not(windows))]
pub fn read_hook_tiers() -> std::collections::HashMap<u32, (u32, String)> {
    std::collections::HashMap::new()
}

#[cfg(windows)]
pub fn dirs_local_shim_dir() -> std::path::PathBuf {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        std::path::PathBuf::from(local).join("ProcWeaver").join("shims")
    } else {
        std::env::temp_dir().join("ProcWeaver").join("shims")
    }
}

#[cfg(windows)]
pub fn apply_shim_mode(mode: &str) -> Result<(), String> {
    use winreg::{enums::*, RegKey};
    let shim_dir = dirs_local_shim_dir();
    let _ = std::fs::create_dir_all(&shim_dir);
    let shim_str = shim_dir.to_string_lossy().to_string();

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (env_key, _) = hkcu.create_subkey(r"Environment").map_err(|e| e.to_string())?;
    let current_path: String = env_key.get_value("Path").unwrap_or_default();

    let mut parts: Vec<&str> = current_path.split(';').filter(|p| !p.trim().is_empty()).collect();
    let contains_path = parts.iter().any(|p| p.eq_ignore_ascii_case(&shim_str));

    match mode {
        "path" => {
            if !contains_path {
                parts.insert(0, &shim_str);
                let new_path = parts.join(";");
                env_key.set_value("Path", &new_path).map_err(|e| e.to_string())?;
                broadcast_setting_change();
            }
            clean_ifeo_keys(&["node.exe", "python.exe", "cursor.exe"]);
        }
        "ifeo" => {
            if contains_path {
                parts.retain(|p| !p.eq_ignore_ascii_case(&shim_str));
                let new_path = parts.join(";");
                env_key.set_value("Path", &new_path).map_err(|e| e.to_string())?;
                broadcast_setting_change();
            }
            apply_ifeo_keys(&["node.exe", "python.exe", "cursor.exe"])?;
        }
        _ => {
            if contains_path {
                parts.retain(|p| !p.eq_ignore_ascii_case(&shim_str));
                let new_path = parts.join(";");
                env_key.set_value("Path", &new_path).map_err(|e| e.to_string())?;
                broadcast_setting_change();
            }
            clean_ifeo_keys(&["node.exe", "python.exe", "cursor.exe"]);
        }
    }
    Ok(())
}

#[cfg(windows)]
fn broadcast_setting_change() {
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        let param: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut result = 0;
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            param.as_ptr() as _,
            SMTO_ABORTIFHUNG,
            1000,
            &mut result,
        );
    }
}

#[cfg(windows)]
fn apply_ifeo_keys(targets: &[&str]) -> Result<(), String> {
    use winreg::{enums::*, RegKey};
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";
    let shim_exe = dirs_local_shim_dir().join("pw_shim.exe");
    let cmd = format!("\"{}\" --pw-bypass", shim_exe.display());

    for target in targets {
        let subkey = format!(r"{}\{}", base, target);
        let key = hklm.create_subkey(&subkey)
            .map_err(|_| format!("启用 IFEO 劫持 [{}] 失败：需要系统管理员权限", target))?.0;
        let _ = key.set_value("Debugger", &cmd);
    }
    Ok(())
}

#[cfg(windows)]
fn clean_ifeo_keys(targets: &[&str]) {
    use winreg::{enums::*, RegKey};
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";
    for target in targets {
        let subkey = format!(r"{}\{}", base, target);
        if let Ok(key) = hklm.open_subkey_with_flags(&subkey, KEY_WRITE) {
            let _ = key.delete_value("Debugger");
        }
    }
}

#[cfg(not(windows))]
pub fn apply_shim_mode(_mode: &str) -> Result<(), String> {
    Ok(())
}
