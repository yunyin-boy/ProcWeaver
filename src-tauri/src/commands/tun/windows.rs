use super::TunStatus;
use ipnet::IpNet;
use serde::Deserialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;
use windows_sys::Win32::{
    NetworkManagement::{
        IpHelper::{
            ConvertInterfaceAliasToLuid, FreeMibTable, GetIfEntry2, GetIpForwardTable2,
            GetUnicastIpAddressTable, MIB_IF_ROW2, MIB_IPFORWARD_ROW2, MIB_UNICASTIPADDRESS_ROW,
        },
        Ndis::IfOperStatusUp,
    },
    Networking::WinSock::{AF_INET, AF_INET6, AF_UNSPEC, IpDadStateDeprecated, IpDadStatePreferred, SOCKADDR_INET},
};

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
struct RuntimeTun {
    enable: bool,
    device: String,
    auto_route: bool,
    inet4_address: Option<Vec<String>>,
    inet6_address: Option<Vec<String>>,
    route_address: Option<Vec<String>>,
    inet4_route_address: Option<Vec<String>>,
    inet6_route_address: Option<Vec<String>>,
    route_exclude_address: Option<Vec<String>>,
    inet4_route_exclude_address: Option<Vec<String>>,
    inet6_route_exclude_address: Option<Vec<String>>,
}

impl RuntimeTun {
    fn addresses(&self) -> Result<Vec<IpNet>, String> {
        parse_prefixes([&self.inet4_address, &self.inet6_address])
    }

    fn confirm_interface(&self) -> Result<(), String> {
        let interface = interface_index(&self.device)?;
        let expected = self.addresses()?;
        let assigned = addresses(interface)?;
        if expected.is_empty() || expected.iter().any(|prefix| !assigned.contains(&prefix.addr())) {
            return Err(format!("TUN 网卡 {} 尚未获得预期 IP 地址", self.device));
        }
        if self.auto_route {
            self.confirm_routes(interface, &expected)?;
        }
        Ok(())
    }

    fn confirm_routes(&self, interface: u32, addresses: &[IpNet]) -> Result<(), String> {
        let mut expected = parse_prefixes([
            &self.route_address, &self.inet4_route_address, &self.inet6_route_address,
        ])?;
        // Windows installs a default route per active address family without an explicit range.
        let defaults = [
            IpNet::new(Ipv4Addr::UNSPECIFIED.into(), 0).unwrap(),
            IpNet::new(Ipv6Addr::UNSPECIFIED.into(), 0).unwrap(),
        ];
        for default in defaults {
            let same_family = |prefix: &IpNet| prefix.addr().is_ipv4() == default.addr().is_ipv4();
            if addresses.iter().any(same_family) && !expected.iter().any(same_family) {
                expected.push(default);
            }
        }
        let mut covered = routes(interface)?;
        // A configured exclusion is allowed to stay on the physical network.
        covered.extend(parse_prefixes([
            &self.route_exclude_address, &self.inet4_route_exclude_address, &self.inet6_route_exclude_address,
        ])?);
        let covered = IpNet::aggregate(&covered);
        for prefix in expected {
            if addresses.iter().any(|addr| addr.addr().is_ipv4() == prefix.addr().is_ipv4())
                && !covered.iter().any(|route| route.contains(&prefix))
            {
                return Err(format!("TUN 网卡 {} 尚未安装 {} 所需的路由", self.device, prefix));
            }
        }
        Ok(())
    }
}

fn parse_prefixes<const N: usize>(fields: [&Option<Vec<String>>; N]) -> Result<Vec<IpNet>, String> {
    fields.into_iter().flatten().flatten().map(|value| {
        value.parse().map_err(|_| "核心返回了无效的 TUN 地址或路由".to_string())
    }).collect()
}

fn interface_index(device: &str) -> Result<u32, String> {
    if device.is_empty() || device.contains('\0') {
        return Err("核心未返回有效的 TUN 网卡名称".into());
    }
    let alias: Vec<u16> = device.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut adapter: MIB_IF_ROW2 = std::mem::zeroed();
        if ConvertInterfaceAliasToLuid(alias.as_ptr(), &mut adapter.InterfaceLuid) != 0
            || GetIfEntry2(&mut adapter) != 0
            || adapter.OperStatus != IfOperStatusUp
        {
            return Err(format!("Windows TUN 网卡 {device} 未就绪"));
        }
        Ok(adapter.InterfaceIndex)
    }
}

fn socket_ip(address: &SOCKADDR_INET) -> Option<IpAddr> {
    // The family discriminates the two address layouts in the Windows union.
    unsafe {
        match address.si_family {
            AF_INET => Some(Ipv4Addr::from(address.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes()).into()),
            AF_INET6 => Some(Ipv6Addr::from(address.Ipv6.sin6_addr.u.Byte).into()),
            _ => None,
        }
    }
}

fn addresses(interface: u32) -> Result<Vec<IpAddr>, String> {
    unsafe {
        let mut table = std::ptr::null_mut();
        let code = GetUnicastIpAddressTable(AF_UNSPEC, &mut table);
        if code != 0 || table.is_null() {
            return Err(format!("无法读取 Windows 地址表（{code}）"));
        }
        // The OS allocates a variable-length table with NumEntries initialized rows.
        let rows = std::slice::from_raw_parts(
            std::ptr::addr_of!((*table).Table).cast(), (*table).NumEntries as usize,
        );
        let found = rows.iter().filter_map(|row: &MIB_UNICASTIPADDRESS_ROW| {
            let usable = row.DadState == IpDadStatePreferred || row.DadState == IpDadStateDeprecated;
            if row.InterfaceIndex != interface || !usable { return None; }
            socket_ip(&row.Address)
        }).collect();
        FreeMibTable(table.cast());
        Ok(found)
    }
}

fn routes(interface: u32) -> Result<Vec<IpNet>, String> {
    unsafe {
        let mut table = std::ptr::null_mut();
        let code = GetIpForwardTable2(AF_UNSPEC, &mut table);
        if code != 0 || table.is_null() {
            return Err(format!("无法读取 Windows 路由表（{code}）"));
        }
        let rows = std::slice::from_raw_parts(
            std::ptr::addr_of!((*table).Table).cast(), (*table).NumEntries as usize,
        );
        let found = rows.iter().filter_map(|row: &MIB_IPFORWARD_ROW2| {
            if row.InterfaceIndex != interface || row.ValidLifetime == 0 {
                return None;
            }
            let dest = row.DestinationPrefix;
            IpNet::new(socket_ip(&dest.Prefix)?, dest.PrefixLength).ok()
        }).collect();
        FreeMibTable(table.cast());
        Ok(found)
    }
}

fn client() -> Result<reqwest::Client, String> {
    crate::commands::mihomo_api::controller_client()
        .timeout(Duration::from_millis(900)).build().map_err(|_| "无法连接核心控制接口".into())
}

async fn read_tun(port: u16, client: &reqwest::Client) -> Result<RuntimeTun, String> {
    #[derive(Deserialize)]
    struct Config { tun: RuntimeTun }

    let r = client.get(format!("http://127.0.0.1:{port}/configs")).send().await
        .map_err(|_| "无法读取核心 TUN 状态")?.error_for_status().map_err(|_| "核心拒绝读取 TUN 状态")?;
    r.json::<Config>().await.map(|config| config.tun).map_err(|_| "核心返回的 TUN 状态无效".into())
}

pub(crate) async fn ready(port: u16) -> bool {
    let Ok(client) = client() else { return false; };
    read_tun(port, &client).await.is_ok_and(|tun| tun.enable && tun.confirm_interface().is_ok())
}

pub(super) async fn observe(mut status: TunStatus, port: u16) -> TunStatus {
    let result = async { read_tun(port, &client()?).await }.await;
    match result {
        Ok(tun) => {
            let error = if tun.enable {
                tun.confirm_interface().err()
            } else if status.configured {
                Some("核心报告 TUN 未启用".into())
            } else {
                None
            };
            status.effective = Some(tun.enable && error.is_none());
            status.auto_route = Some(tun.auto_route);
            status.detail = error;
        }
        Err(error) => status.detail = Some(error),
    }
    status
}

pub(crate) async fn confirm(port: u16, expected: bool) -> Result<(), String> {
    let client = client()?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(6);
    loop {
        let result = match read_tun(port, &client).await {
            Ok(tun) if tun.enable && expected => tun.confirm_interface(),
            Ok(tun) if !tun.enable && !expected => Ok(()),
            Ok(_) if expected => Err("核心报告 TUN 未启用，请检查运行日志和 TUN 配置".into()),
            Ok(_) => Err("核心尚未关闭 TUN".into()),
            Err(error) => Err(error),
        };
        if result.is_ok() || tokio::time::Instant::now() >= deadline {
            return result;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}
