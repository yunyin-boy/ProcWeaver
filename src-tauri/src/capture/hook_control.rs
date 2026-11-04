//! A launch lease only disables old Hook sessions; re-enabling creates a new lease.
use std::{collections::BTreeMap, sync::{LazyLock, Mutex}};
use windows_sys::Win32::{Foundation::{CloseHandle, HANDLE}, System::Threading::{CreateEventW, SetEvent}};

struct Lease { event: HANDLE, ready: HANDLE, name: String }
// Handles are owned here; Win32 event operations are thread-safe.
unsafe impl Send for Lease {}
impl Drop for Lease {
    fn drop(&mut self) { unsafe { SetEvent(self.event); CloseHandle(self.event); CloseHandle(self.ready); } }
}
static LEASES: LazyLock<Mutex<BTreeMap<u16, Vec<Lease>>>> = LazyLock::new(|| Mutex::new(BTreeMap::new()));

pub fn create(port: u16) -> Result<String, String> {
    use std::os::windows::ffi::OsStrExt;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Hook 会话时钟无效")?.as_nanos();
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = format!("Local\\ProcWeaverHook_{}_{}_{}_{}", std::process::id(), port, nonce, serial);
    let wide: Vec<u16> = std::ffi::OsStr::new(&name).encode_wide().chain(Some(0)).collect();
    let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, wide.as_ptr()) };
    if event.is_null() { return Err("创建 Hook 撤销门禁失败，未启动应用".into()); }
    let ready_name: Vec<u16> = std::ffi::OsString::from(format!("{name}_ready")).encode_wide().chain(Some(0)).collect();
    let ready = unsafe { CreateEventW(std::ptr::null(), 1, 0, ready_name.as_ptr()) };
    if ready.is_null() { unsafe { CloseHandle(event); } return Err("创建 Hook 撤销确认失败，未启动应用".into()); }
    LEASES.lock().unwrap_or_else(|e| e.into_inner()).entry(port).or_default().push(Lease { event, ready, name: name.clone() });
    Ok(name)
}

pub fn confirm(name: &str) -> Result<(), String> {
    let leases = LEASES.lock().unwrap_or_else(|e| e.into_inner());
    let lease = leases.values().flatten().find(|lease| lease.name == name).ok_or("Hook 会话已撤销")?;
    if unsafe { windows_sys::Win32::System::Threading::WaitForSingleObject(lease.ready, 3000) } != 0 {
        return Err("应用可能已启动，但 Hook 撤销通道尚未确认；请正常退出应用后检查权限并重试".into());
    }
    Ok(())
}

pub fn retain_ports(ports: &[u16]) {
    // Dropping the host handle signals the event first; injected children retain
    // their read handle and remain disabled even if this port is reused later.
    LEASES.lock().unwrap_or_else(|e| e.into_inner()).retain(|port, leases| {
        let retain = ports.contains(port);
        if !retain { leases.clear(); }
        retain
    });
}

pub fn revoke(name: &str) {
    LEASES.lock().unwrap_or_else(|e| e.into_inner()).retain(|_, leases| {
        leases.retain(|lease| lease.name != name);
        !leases.is_empty()
    });
}

pub fn stop() { retain_ports(&[]); }

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::System::Threading::{OpenEventW, WaitForSingleObject};
    #[test]
    fn revoked_launch_lease_cannot_resume_when_port_is_reused() {
        use std::os::windows::ffi::OsStrExt;
        let port = 34999;
        let name = create(port).unwrap();
        let wide: Vec<u16> = std::ffi::OsStr::new(&name).encode_wide().chain(Some(0)).collect();
        let observed = unsafe { OpenEventW(0x00100000, 0, wide.as_ptr()) };
        assert!(!observed.is_null());
        assert_eq!(unsafe { WaitForSingleObject(observed, 0) }, 258);
        retain_ports(&[]);
        assert_eq!(unsafe { WaitForSingleObject(observed, 0) }, 0);
        assert_ne!(name, create(port).unwrap());
        assert_eq!(unsafe { WaitForSingleObject(observed, 0) }, 0);
        unsafe { CloseHandle(observed); }
        stop();
    }
}
