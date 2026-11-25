use crate::routing_overrides::model::BundlePolicy;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Mode {
    #[default]
    SafePure,
    FakeIp,
    SystemNative,
}

impl Mode {
    pub(crate) fn for_policy(policy: Option<&BundlePolicy>) -> Self {
        match policy.map(|policy| policy.dns_mode.as_str()) {
            Some("fake_ip") => Self::FakeIp,
            Some("system_native" | "system") => Self::SystemNative,
            _ => Self::SafePure,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::SafePure => "safe_pure",
            Self::FakeIp => "fake_ip",
            Self::SystemNative => "system_native",
        }
    }
}

pub(crate) fn system_servers() -> Vec<IpAddr> {
    use windows_sys::Win32::{
        Foundation::{ERROR_BUFFER_OVERFLOW, NO_ERROR},
        NetworkManagement::{IpHelper::*, Ndis::IfOperStatusUp},
        Networking::WinSock::{AF_INET, AF_INET6, AF_UNSPEC, SOCKADDR_IN, SOCKADDR_IN6},
    };

    let flags = GAA_FLAG_SKIP_UNICAST
        | GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_FRIENDLY_NAME;
    let mut size = 15 * 1024;
    for _ in 0..3 {
        if size > 4 * 1024 * 1024 {
            break;
        }
        // The adapter and DNS linked lists point into the aligned caller buffer.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let mut adapter = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        let result = unsafe {
            GetAdaptersAddresses(
                u32::from(AF_UNSPEC),
                flags,
                std::ptr::null(),
                adapter,
                &mut size,
            )
        };
        if result == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if result != NO_ERROR {
            break;
        }
        let mut servers = Vec::new();
        unsafe {
            while let Some(entry) = adapter.as_ref() {
                if entry.OperStatus == IfOperStatusUp {
                    let mut address = entry.FirstDnsServerAddress;
                    while let Some(dns) = address.as_ref() {
                        let socket = dns.Address.lpSockaddr;
                        let len = dns.Address.iSockaddrLength as usize;
                        if !socket.is_null() && len >= std::mem::size_of::<u16>() {
                            let ip = match (*socket).sa_family {
                                AF_INET if len >= std::mem::size_of::<SOCKADDR_IN>() => {
                                    let addr = &*socket.cast::<SOCKADDR_IN>();
                                    Some(IpAddr::V4(Ipv4Addr::from(
                                        addr.sin_addr.S_un.S_addr.to_ne_bytes(),
                                    )))
                                }
                                AF_INET6 if len >= std::mem::size_of::<SOCKADDR_IN6>() => {
                                    let addr = &*socket.cast::<SOCKADDR_IN6>();
                                    Some(IpAddr::V6(Ipv6Addr::from(addr.sin6_addr.u.Byte)))
                                }
                                _ => None,
                            };
                            servers
                                .extend(ip.filter(|ip| !ip.is_unspecified() && !ip.is_multicast()));
                        }
                        address = dns.Next;
                    }
                }
                adapter = entry.Next;
            }
        }
        servers.sort_unstable();
        servers.dedup();
        return servers;
    }
    Vec::new()
}
