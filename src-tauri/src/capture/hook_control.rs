//! A launch lease only disables old Hook sessions; re-enabling creates a new lease.
use std::{collections::BTreeMap, sync::{LazyLock, Mutex}};
use windows_sys::Win32::{Foundation::{CloseHandle, HANDLE}, System::Threading::{CreateEventW, SetEvent}};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SessionPolicy<'a> {
    pub rule_id: &'a str,
    pub revision: u64,
    pub external: bool,
}

struct Lease {
    event: HANDLE,
    ready: HANDLE,
    port: u16,
    reject: bool,
    policy: Option<(String, u64, bool)>,
    process: Option<(u32, u64)>,
}
// Handles are owned here; Win32 event operations are thread-safe.
unsafe impl Send for Lease {}
impl Drop for Lease {
    fn drop(&mut self) { unsafe { SetEvent(self.event); CloseHandle(self.event); CloseHandle(self.ready); } }
}
static LEASES: LazyLock<Mutex<BTreeMap<String, Lease>>> = LazyLock::new(|| Mutex::new(BTreeMap::new()));
static PROXY_PORTS: LazyLock<Mutex<BTreeMap<(u32, u64), u16>>> = LazyLock::new(|| Mutex::new(BTreeMap::new()));

pub fn create(port: u16, policy: Option<SessionPolicy<'_>>, reject: bool) -> Result<String, String> {
    use std::os::windows::ffi::OsStrExt;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Hook 会话时钟无效")?.as_nanos();
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = format!("Local\\ProcWeaverHook_{}_{}_{}_{}", std::process::id(), port, nonce, serial);
    let wide: Vec<u16> = std::ffi::OsStr::new(&name).encode_wide().chain(Some(0)).collect();
    let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, wide.as_ptr()) };
    if event.is_null() { return Err("创建 Hook 撤销门禁失败，未启动应用".into()); }
    let suffix = if reject { "_reject_ready" } else if policy.is_some() { "_policy_ready" } else { "_ready" };
    let ready_name: Vec<u16> = std::ffi::OsString::from(format!("{name}{suffix}")).encode_wide().chain(Some(0)).collect();
    let ready = unsafe { CreateEventW(std::ptr::null(), 1, 0, ready_name.as_ptr()) };
    if ready.is_null() { unsafe { CloseHandle(event); } return Err("创建 Hook 撤销确认失败，未启动应用".into()); }
    LEASES.lock().unwrap_or_else(|e| e.into_inner()).insert(name.clone(), Lease {
        event, ready, port, reject,
        policy: policy.map(|p| (p.rule_id.to_owned(), p.revision, p.external)),
        process: None,
    });
    Ok(name)
}

pub fn confirm(name: &str, pid: u32, created_at: u64, native_proxy: bool) -> Result<(), String> {
    let mut leases = LEASES.lock().unwrap_or_else(|e| e.into_inner());
    let lease = leases.get_mut(name).ok_or("Hook 会话已撤销")?;
    if created_at == 0 { return Err("无法核验受控启动的进程身份".into()); }
    if unsafe { windows_sys::Win32::System::Threading::WaitForSingleObject(lease.ready, 3000) } != 0 {
        return Err(if lease.reject { "未确认 Hook 网络阻断，启动失败" }
            else { "应用可能已启动，但 Hook 撤销通道尚未确认；请正常退出应用后检查权限并重试" }.into());
    }
    lease.process = Some((pid, created_at));
    if native_proxy && lease.port != 0 {
        let mut ports = PROXY_PORTS.lock().unwrap_or_else(|e| e.into_inner());
        if ports.len() >= 4096 { ports.clear(); }
        ports.insert((pid, created_at), lease.port);
    }
    Ok(())
}

pub fn matches(pid: u32, created_at: u64, policy: SessionPolicy<'_>, port: u16, reject: bool) -> bool {
    created_at != 0 && LEASES.lock().unwrap_or_else(|e| e.into_inner()).values().any(|lease|
        lease.process == Some((pid, created_at)) && lease.port == port && lease.reject == reject
        && lease.policy.as_ref().is_some_and(|(id, revision, external)|
            id == policy.rule_id && *revision == policy.revision && *external == policy.external))
}

pub fn previous_proxy_ports(pid: u32, created_at: u64) -> Vec<u16> {
    PROXY_PORTS.lock().unwrap_or_else(|e| e.into_inner()).get(&(pid, created_at)).copied().into_iter().collect()
}

pub fn retain_core(ports: &[u16], reject_overrides_changed: bool) {
    LEASES.lock().unwrap_or_else(|e| e.into_inner()).retain(|_, lease| {
        if lease.policy.as_ref().is_some_and(|(_, _, external)| *external) { return true; }
        // Each child inherits its launcher's lease and may use a REJECT override.
        // Once one of those overrides is withdrawn, retire the old snapshots.
        !reject_overrides_changed && (lease.reject || ports.contains(&lease.port))
    });
}

pub fn retain_external(mut active: impl FnMut(&str, u16) -> bool) {
    LEASES.lock().unwrap_or_else(|e| e.into_inner()).retain(|_, lease| {
        !lease.policy.as_ref().is_some_and(|(id, _, external)| *external && !active(id, lease.port))
    });
}

pub fn revoke(name: &str) {
    LEASES.lock().unwrap_or_else(|e| e.into_inner()).remove(name);
}

pub fn stop() { LEASES.lock().unwrap_or_else(|e| e.into_inner()).clear(); }

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::System::Threading::{OpenEventW, WaitForSingleObject};
    #[test]
    fn revoked_launch_lease_cannot_resume_when_port_is_reused() {
        use std::os::windows::ffi::OsStrExt;
        let port = 34999;
        let name = create(port, None, false).unwrap();
        let wide: Vec<u16> = std::ffi::OsStr::new(&name).encode_wide().chain(Some(0)).collect();
        let observed = unsafe { OpenEventW(0x00100000, 0, wide.as_ptr()) };
        assert!(!observed.is_null());
        assert_eq!(unsafe { WaitForSingleObject(observed, 0) }, 258);
        stop();
        assert_eq!(unsafe { WaitForSingleObject(observed, 0) }, 0);
        assert_ne!(name, create(port, None, false).unwrap());
        assert_eq!(unsafe { WaitForSingleObject(observed, 0) }, 0);
        unsafe { CloseHandle(observed); }
        stop();
    }

    #[test]
    fn reject_reuse_requires_acknowledgment_identity_and_current_policy() {
        use std::os::windows::ffi::OsStrExt;
        let policy = SessionPolicy { rule_id: "block-app", revision: 8, external: false };
        let name = create(0, Some(policy), true).unwrap();
        let event = |suffix: &str| {
            let wide: Vec<u16> = std::ffi::OsString::from(format!("{name}{suffix}")).encode_wide().chain(Some(0)).collect();
            unsafe { OpenEventW(0x00100002, 0, wide.as_ptr()) }
        };
        let withdraw = event("");
        let ready = event("_reject_ready");
        assert!(!withdraw.is_null() && !ready.is_null());
        assert!(event("_ready").is_null());
        assert!(!matches(42, 170, policy, 0, true));
        assert_eq!(unsafe { SetEvent(ready) }, 1);
        confirm(&name, 42, 170, false).unwrap();

        assert!(matches(42, 170, policy, 0, true));
        assert!(!matches(42, 171, policy, 0, true));
        assert!(!matches(42, 170, policy, 0, false));
        assert!(!matches(42, 170, policy, 32000, true));
        assert!(!matches(42, 170, SessionPolicy { revision: 9, ..policy }, 0, true));
        assert!(!matches(42, 170, SessionPolicy { rule_id: "other", ..policy }, 0, true));
        assert!(!matches(42, 170, SessionPolicy { external: true, ..policy }, 0, true));

        retain_core(&[], false);
        assert!(matches(42, 170, policy, 0, true));
        retain_core(&[], true);
        assert!(!matches(42, 170, policy, 0, true));
        assert_eq!(unsafe { WaitForSingleObject(withdraw, 0) }, 0);
        unsafe { CloseHandle(withdraw); CloseHandle(ready); }
    }

    #[test]
    fn versioned_proxy_session_has_a_distinct_acknowledgment() {
        use std::os::windows::ffi::OsStrExt;
        let policy = SessionPolicy { rule_id: "proxy-app", revision: 2, external: true };
        let name = create(32000, Some(policy), false).unwrap();
        let event = |suffix: &str| {
            let wide: Vec<u16> = std::ffi::OsString::from(format!("{name}{suffix}")).encode_wide().chain(Some(0)).collect();
            unsafe { OpenEventW(0x00100002, 0, wide.as_ptr()) }
        };
        assert!(event("_ready").is_null());
        let ready = event("_policy_ready");
        assert!(!ready.is_null());
        assert_eq!(unsafe { SetEvent(ready) }, 1);
        confirm(&name, 43, 171, true).unwrap();
        assert!(matches(43, 171, policy, 32000, false));
        retain_external(|_, _| false);
        assert!(!matches(43, 171, policy, 32000, false));
        assert_eq!(previous_proxy_ports(43, 171), vec![32000]);
        assert!(previous_proxy_ports(43, 172).is_empty());
        unsafe { CloseHandle(ready); }
    }
}
