//! Runtime-owned Windows Firewall exceptions for the reflected TCP listeners.
use super::ownership::Identity;
use crate::commands::windows_integration::com;
use std::{
    collections::{BTreeSet, HashMap},
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    time::{Duration, Instant},
};
use windows::{
    core::{Interface, BSTR},
    Win32::{
        Foundation::{VARIANT_FALSE, VARIANT_TRUE},
        NetworkManagement::WindowsFirewall::*,
        System::{
            Com::{CoCreateInstance, IDispatch, CLSCTX_INPROC_SERVER},
            Ole::IEnumVARIANT,
            Variant::{VARIANT, VT_EMPTY, VT_NULL},
        },
    },
};
use windows_sys::Win32::{
    Foundation::ERROR_NOT_FOUND,
    NetworkManagement::{
        IpHelper::{
            FreeMibTable, GetIfEntry2, GetUnicastIpAddressTable, MIB_IF_ROW2,
            MIB_UNICASTIPADDRESS_ROW, MIB_UNICASTIPADDRESS_TABLE,
        },
        Ndis::IfOperStatusUp,
    },
    Networking::WinSock::{
        IpDadStateDeprecated, IpDadStatePreferred, AF_INET, AF_INET6, AF_UNSPEC,
    },
};

const GROUP: &str = "ProcWeaver WinDivert Relay";
const NAME_PREFIX: &str = "ProcWeaver WinDivert TCP ";

#[derive(Default, PartialEq, Eq)]
struct Scope {
    enabled_profiles: i32,
    default_block_profiles: i32,
    addresses: [BTreeSet<IpAddr>; 2],
}

pub(super) struct RelayFirewall {
    owner: Identity,
    ports: [u16; 2],
    scope: Scope,
    installed: Vec<String>,
    checked: Instant,
}

impl RelayFirewall {
    pub(super) fn start(ports: [u16; 2]) -> Result<Self, String> {
        let owner = Identity::inspect(std::process::id()).ok_or("无法识别 WinDivert 中继进程")?;
        let mut relay = Self {
            owner,
            ports,
            scope: Scope::default(),
            installed: Vec::new(),
            checked: Instant::now(),
        };
        with_policy(|policy| relay.sync(policy, true))?;
        Ok(relay)
    }

    pub(super) fn refresh(&mut self) -> Result<(), String> {
        if self.checked.elapsed() < Duration::from_secs(1) {
            return Ok(());
        }
        self.checked = Instant::now();
        with_policy(|policy| self.sync(policy, false))
    }

    fn sync(&mut self, policy: &INetFwPolicy2, starting: bool) -> Result<(), String> {
        let scope = current_scope(policy);
        if !starting {
            match &scope {
                Ok(scope) if *scope == self.scope => return Ok(()),
                Err(error) => return Err(error.clone()),
                Ok(_) => {}
            }
        }
        let rules = unsafe { policy.Rules() }.map_err(firewall_error)?;
        let profiles = scope.as_ref().map_or(0, |scope| scope.enabled_profiles);
        check_rules(&rules, &self.owner, profiles, starting)?;
        let scope = scope?;
        self.remove(&rules)?;
        for (index, addresses) in scope.addresses.iter().enumerate() {
            if addresses.is_empty() || scope.default_block_profiles == 0 {
                continue;
            }
            let family = if index == 0 { "IPv4" } else { "IPv6" };
            let port = self.ports[index];
            let name = format!(
                "{NAME_PREFIX}{} {} {family} {port}",
                self.owner.pid, self.owner.created_at
            );
            let local = addresses
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(",");
            unsafe {
                let rule: INetFwRule = CoCreateInstance(&NetFwRule, None, CLSCTX_INPROC_SERVER)
                    .map_err(firewall_error)?;
                (|| {
                    rule.SetName(&BSTR::from(&name))?;
                    rule.SetGrouping(&BSTR::from(GROUP))?;
                    rule.SetApplicationName(&BSTR::from(&self.owner.path))?;
                    rule.SetDirection(NET_FW_RULE_DIR_IN)?;
                    rule.SetProtocol(NET_FW_IP_PROTOCOL_TCP.0)?;
                    rule.SetLocalPorts(&BSTR::from(port.to_string()))?;
                    rule.SetLocalAddresses(&BSTR::from(local))?;
                    rule.SetProfiles(scope.default_block_profiles)?;
                    rule.SetEdgeTraversal(VARIANT_FALSE)?;
                    rule.SetAction(NET_FW_ACTION_ALLOW)?;
                    rule.SetEnabled(VARIANT_TRUE)?;
                    rules.Add(&rule)
                })()
                .map_err(firewall_error)?;
            }
            self.installed.push(name);
        }
        self.scope = scope;
        Ok(())
    }

    fn remove(&mut self, rules: &INetFwRules) -> Result<(), String> {
        let mut error = None;
        self.installed.retain(|name| {
            if let Err(e) = unsafe { rules.Remove(&BSTR::from(name)) } {
                error = Some(firewall_error(e));
                true
            } else {
                false
            }
        });
        error.map_or(Ok(()), Err)
    }
}

impl Drop for RelayFirewall {
    fn drop(&mut self) {
        if !self.installed.is_empty() {
            let _ = with_policy(|policy| {
                self.remove(&unsafe { policy.Rules() }.map_err(firewall_error)?)
            });
        }
    }
}

fn with_policy<T>(action: impl FnOnce(&INetFwPolicy2) -> Result<T, String>) -> Result<T, String> {
    com(|| {
        let policy = unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER) }
            .map_err(firewall_error)?;
        action(&policy)
    })
}

fn firewall_error(error: windows::core::Error) -> String {
    format!("WinDivert 中继防火墙规则配置失败（{}）", error.code())
}

fn current_scope(policy: &INetFwPolicy2) -> Result<Scope, String> {
    // INetFwPolicy2 accepts one profile at a time for the profile settings.
    let mut scope = Scope::default();
    unsafe {
        let current = policy.CurrentProfileTypes().map_err(firewall_error)?;
        for profile in [
            NET_FW_PROFILE2_DOMAIN,
            NET_FW_PROFILE2_PRIVATE,
            NET_FW_PROFILE2_PUBLIC,
        ] {
            if current & profile.0 == 0
                || !policy
                    .get_FirewallEnabled(profile)
                    .map_err(firewall_error)?
                    .as_bool()
            {
                continue;
            }
            scope.enabled_profiles |= profile.0;
            if policy
                .get_BlockAllInboundTraffic(profile)
                .map_err(firewall_error)?
                .as_bool()
            {
                return Err("Windows 防火墙策略阻止所有入站连接，WinDivert 中继无法启动".into());
            }
            if policy
                .get_DefaultInboundAction(profile)
                .map_err(firewall_error)?
                == NET_FW_ACTION_BLOCK
            {
                scope.default_block_profiles |= profile.0;
            }
        }
        if scope.default_block_profiles != 0 {
            match policy.LocalPolicyModifyState().map_err(firewall_error)? {
                NET_FW_MODIFY_STATE_OK => {}
                NET_FW_MODIFY_STATE_GP_OVERRIDE => {
                    return Err(
                        "Windows 防火墙策略禁止应用本地入站规则，WinDivert 中继无法启动".into(),
                    );
                }
                _ => return Err("Windows 防火墙策略阻止入站放行，WinDivert 中继无法启动".into()),
            }
            scope.addresses = local_addresses()?;
        }
    }
    Ok(scope)
}

fn check_rules(
    rules: &INetFwRules,
    owner: &Identity,
    profiles: i32,
    clean_stale: bool,
) -> Result<(), String> {
    let mut stale = Vec::new();
    let mut blocked = None;
    unsafe {
        let iter: IEnumVARIANT = rules
            ._NewEnum()
            .and_then(|enumerator| enumerator.cast())
            .map_err(firewall_error)?;
        loop {
            let mut value = [VARIANT::default()];
            let mut fetched = 0;
            iter.Next(&mut value, &mut fetched)
                .ok()
                .map_err(firewall_error)?;
            if fetched == 0 {
                break;
            }
            let rule: INetFwRule = IDispatch::try_from(&value[0])
                .and_then(|rule| rule.cast())
                .map_err(firewall_error)?;
            let name = rule.Name().map_err(firewall_error)?.to_string();
            if clean_stale
                && name.starts_with(NAME_PREFIX)
                && rule.Grouping().map_err(firewall_error)? == GROUP
            {
                let application = rule.ApplicationName().map_err(firewall_error)?;
                if is_orphaned(&name, &application.to_string()) {
                    stale.push(name.clone());
                }
            }
            if profiles != 0 && blocks_application(&rule, owner, profiles).unwrap_or(false) {
                blocked = Some(name);
            }
        }
        for name in stale {
            rules.Remove(&BSTR::from(name)).map_err(firewall_error)?;
        }
    }
    if let Some(name) = blocked {
        return Err(format!(
            "Windows 防火墙规则「{name}」阻止本程序的入站 TCP 连接，WinDivert 中继无法启动"
        ));
    }
    Ok(())
}

fn is_orphaned(name: &str, application: &str) -> bool {
    let Some(fields) = name.strip_prefix(NAME_PREFIX) else {
        return false;
    };
    let fields: Vec<_> = fields.split_ascii_whitespace().collect();
    let [pid, created, "IPv4" | "IPv6", port] = fields.as_slice() else {
        return false;
    };
    let (Ok(pid @ 1..), Ok(created @ 1..), Ok(1..)) = (
        pid.parse::<u32>(),
        created.parse::<u64>(),
        port.parse::<u16>(),
    ) else {
        return false;
    };
    !application.is_empty()
        && !Identity::inspect(pid).is_some_and(|process| {
            process.created_at == created && process.path.eq_ignore_ascii_case(application)
        })
}

// Only diagnose a blanket app deny here. Windows evaluates conditional rules
// against each real connection, including restrictions that depend on the peer.
fn blocks_application(
    rule: &INetFwRule,
    owner: &Identity,
    profiles: i32,
) -> windows::core::Result<bool> {
    let unrestricted = |value: BSTR| value.is_empty() || value == "*";
    unsafe {
        if rule.Action()? != NET_FW_ACTION_BLOCK
            || rule.Direction()? != NET_FW_RULE_DIR_IN
            || !rule.Enabled()?.as_bool()
            || rule.Profiles()? & profiles != profiles
            || !rule
                .ApplicationName()?
                .to_string()
                .eq_ignore_ascii_case(&owner.path)
            || ![NET_FW_IP_PROTOCOL_TCP.0, NET_FW_IP_PROTOCOL_ANY.0].contains(&rule.Protocol()?)
            || !rule.ServiceName()?.is_empty()
            || !unrestricted(rule.LocalPorts()?)
            || !unrestricted(rule.RemotePorts()?)
            || !unrestricted(rule.LocalAddresses()?)
            || !unrestricted(rule.RemoteAddresses()?)
        {
            return Ok(false);
        }
        let interface_type = rule.InterfaceTypes()?;
        let interfaces = rule.Interfaces()?;
        let rule: INetFwRule3 = rule.cast()?;
        Ok(
            (unrestricted(interface_type.clone()) || interface_type == "All")
                && matches!(interfaces.Anonymous.Anonymous.vt, VT_EMPTY | VT_NULL)
                && rule.LocalAppPackageId()?.is_empty()
                && rule.LocalUserAuthorizedList()?.is_empty()
                && rule.RemoteUserAuthorizedList()?.is_empty()
                && rule.RemoteMachineAuthorizedList()?.is_empty()
                && rule.SecureFlags()? == 0,
        )
    }
}

fn local_addresses() -> Result<[BTreeSet<IpAddr>; 2], String> {
    struct AddressTable(*mut MIB_UNICASTIPADDRESS_TABLE);
    impl Drop for AddressTable {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { FreeMibTable(self.0.cast()) };
            }
        }
    }
    let mut addresses: [BTreeSet<IpAddr>; 2] = Default::default();
    let mut table = AddressTable(std::ptr::null_mut());
    let status = unsafe { GetUnicastIpAddressTable(AF_UNSPEC, &mut table.0) };
    if status == ERROR_NOT_FOUND {
        return Ok(addresses);
    }
    if status != 0 || table.0.is_null() {
        return Err(format!(
            "无法读取 WinDivert 中继的本机地址（系统代码 {status}）"
        ));
    }
    let mut active_interfaces = HashMap::new();
    unsafe {
        let rows = std::ptr::addr_of!((*table.0).Table).cast::<MIB_UNICASTIPADDRESS_ROW>();
        let rows = std::slice::from_raw_parts(rows, (*table.0).NumEntries as usize);
        for row in rows {
            if row.ValidLifetime == 0
                || ![IpDadStatePreferred, IpDadStateDeprecated].contains(&row.DadState)
            {
                continue;
            }
            let (family, ip) = match row.Address.si_family {
                AF_INET => (
                    0,
                    IpAddr::V4(Ipv4Addr::from(
                        row.Address.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes(),
                    )),
                ),
                AF_INET6 => (
                    1,
                    IpAddr::V6(Ipv6Addr::from(row.Address.Ipv6.sin6_addr.u.Byte)),
                ),
                _ => continue,
            };
            if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
                continue;
            }
            let up = active_interfaces
                .entry(row.InterfaceIndex)
                .or_insert_with(|| {
                    let mut adapter: MIB_IF_ROW2 = std::mem::zeroed();
                    adapter.InterfaceIndex = row.InterfaceIndex;
                    GetIfEntry2(&mut adapter) == 0 && adapter.OperStatus == IfOperStatusUp
                });
            if *up {
                addresses[family].insert(ip);
            }
        }
    }
    Ok(addresses)
}
