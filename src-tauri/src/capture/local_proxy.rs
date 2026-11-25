//! 精确受控的本地回环系统代理双向 NAT 重定向机制。
//! 针对命中了进程专属规则的连接，若其向 ProcWeaver 托管的系统代理（如 127.0.0.1:7890）发起请求，
//! 本模块在本地进行双向地址与端口转换，直接导向该规则专属的 Mixed 入口，
//! 既保留客户端原生的 HTTP CONNECT / SOCKS 报文，又杜绝被全局公共规则吞没。

use super::packet::Flow;
use crate::capture::windivert::ownership::Identity;
use std::{collections::HashMap, net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr}, time::{Duration, Instant}};

/// 获取 ProcWeaver 明确管理的回环代理端点（支持宿主环境安全调用）
pub fn managed_endpoints() -> Vec<SocketAddr> {
    let port = if crate::storage::is_initialized() {
        crate::commands::settings::get_general_settings().map(|s| s.mixed_port).unwrap_or(0)
    } else {
        0
    };
    managed_endpoints_with_port(if port != 0 { Some(port) } else { None })
}

/// 基于明确传入的 mixed_port 生成受管端点，绝不自主读取存储，供辅助进程或明确配置场景使用
pub fn managed_endpoints_with_port(mixed_port: Option<u16>) -> Vec<SocketAddr> {
    let mut result = Vec::new();
    if let Some(port) = mixed_port {
        if port != 0 {
            result.push(SocketAddr::from(([127, 0, 0, 1], port)));
            result.push(SocketAddr::from((Ipv6Addr::LOCALHOST, port)));
        }
    }
    // Windows 系统注册表当前激活的系统代理端点（仅收录回环端点）
    for ep in endpoints() {
        if !result.contains(&ep) {
            result.push(ep);
        }
    }
    result.sort();
    result.dedup();
    result
}

pub fn endpoints() -> Vec<SocketAddr> {
    #[cfg(windows)]
    {
        use winreg::{enums::*, RegKey};
        let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", KEY_READ) else { return vec![]; };
        if key.get_value::<u32, _>("ProxyEnable").unwrap_or(0) == 0 { return vec![]; }
        parse(&key.get_value::<String, _>("ProxyServer").unwrap_or_default())
    }
    #[cfg(not(windows))]
    {
        vec![]
    }
}

fn parse(text: &str) -> Vec<SocketAddr> {
    let mut result = vec![];
    for entry in text.split(';').take(16) {
        let address = match entry.split_once('=') { Some((kind,v)) if ["http","https","socks"].contains(&kind.trim().to_ascii_lowercase().as_str()) => v, Some(_) => continue, None => entry }.trim();
        if let Some(port) = address.to_ascii_lowercase().strip_prefix("localhost:").and_then(|v| v.parse::<u16>().ok()).filter(|p| *p != 0) {
            result.extend([SocketAddr::from(([127,0,0,1],port)), SocketAddr::from((Ipv6Addr::LOCALHOST,port))]);
        } else if let Ok(address) = address.parse::<SocketAddr>() {
            if address.ip().is_loopback() && address.port() != 0 { result.push(address); }
        }
    }
    result.sort(); result.dedup(); result
}

fn reverse(flow: Flow) -> Flow { Flow { source: flow.destination, destination: flow.source, protocol: flow.protocol } }

#[derive(Clone, Debug)]
pub struct NatEntry {
    pub to: Flow,
    pub peer: Flow,
    pub touched: Instant,
    pub closed: bool,
    pub established: bool,
    pub identity: Option<Identity>,
    pub port: u16,
}

#[derive(Default)]
pub struct Nat {
    pub entries: HashMap<Flow, NatEntry>,
}

impl Nat {
    pub fn forget(&mut self, flow: Flow) {
        if let Some(entry) = self.entries.remove(&flow) {
            self.entries.remove(&entry.peer);
        }
    }

    /// 检测是否为针对同一出口的目标重定向三次握手 SYN 重传
    pub fn is_syn_retransmission(&self, flow: Flow, port: u16) -> bool {
        if let Some(entry) = self.entries.get(&flow) {
            if entry.port == port && !entry.established && entry.touched.elapsed() < Duration::from_secs(3) {
                return true;
            }
        }
        false
    }

    /// 翻译数据包并刷新会话状态
    pub fn translate(&mut self, flow: Flow, closed: bool, acknowledged: bool) -> Option<Flow> {
        let entry = self.entries.get_mut(&flow)?;
        entry.touched = Instant::now();
        entry.closed |= closed;
        entry.established |= acknowledged;
        let (to, peer) = (entry.to, entry.peer);
        if let Some(other) = self.entries.get_mut(&peer) {
            other.touched = Instant::now();
            other.closed |= closed;
            other.established |= acknowledged;
        }
        Some(to)
    }

    /// 插入新的本地代理重定向双向映射
    pub fn insert(&mut self, flow: Flow, port: u16, identity: Option<Identity>) -> bool {
        if self.entries.len() >= 8192 {
            return false;
        }
        let ip: IpAddr = if flow.source.is_ipv4() {
            Ipv4Addr::LOCALHOST.into()
        } else {
            Ipv6Addr::LOCALHOST.into()
        };
        let translated = Flow {
            destination: SocketAddr::new(ip, port),
            ..flow
        };
        let peer = reverse(translated);
        // 绝不将不同原始连接合并到同一本地元组
        if self.entries.contains_key(&peer) {
            return false;
        }
        self.entries.insert(
            flow,
            NatEntry {
                to: translated,
                peer,
                touched: Instant::now(),
                closed: false,
                established: false,
                identity: identity.clone(),
                port,
            },
        );
        self.entries.insert(
            peer,
            NatEntry {
                to: reverse(flow),
                peer: flow,
                touched: Instant::now(),
                closed: false,
                established: false,
                identity,
                port,
            },
        );
        true
    }

    /// 定期平滑清理过期和已断开的 NAT 会话
    pub fn cleanup(&mut self) {
        self.entries.retain(|_, e| {
            if !e.established {
                e.touched.elapsed() < Duration::from_secs(30)
            } else {
                !e.closed || e.touched.elapsed() < Duration::from_secs(180)
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_proxy_endpoints_are_scoped() {
        let values = parse("http=localhost:10811;https=[::1]:7890;socks=127.0.0.1:9000;http=192.168.1.1:80;bad;127.0.0.1:0");
        assert_eq!(values.len(), 4);
        assert!(values.iter().all(|v| v.ip().is_loopback() && v.port() != 0));
    }

    #[test]
    fn tuples_do_not_merge_and_closed_routes_are_reclaimed() {
        let source = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let target = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let flow = Flow {
            source: source.local_addr().unwrap(),
            destination: "127.0.0.1:10811".parse().unwrap(),
            protocol: 6,
        };
        let mut nat = Nat::default();
        assert!(nat.insert(flow, target.local_addr().unwrap().port(), None));
        assert!(!nat.insert(Flow { destination: "127.0.0.1:10812".parse().unwrap(), ..flow }, target.local_addr().unwrap().port(), None));
        let mapped = nat.translate(flow, false, false).unwrap();
        assert_eq!(nat.translate(reverse(mapped), false, true), Some(reverse(flow)));
        for entry in nat.entries.values_mut() {
            entry.touched = Instant::now() - Duration::from_secs(61);
        }
        nat.cleanup();
        assert_eq!(nat.entries.len(), 2);
        for entry in nat.entries.values_mut() {
            entry.closed = true;
        }
        // 半关闭在 61 秒时应继续保留，防止长响应尾包被误丢或原样旁路
        nat.cleanup();
        assert_eq!(nat.entries.len(), 2);
        for entry in nat.entries.values_mut() {
            entry.touched = Instant::now() - Duration::from_secs(181);
        }
        nat.cleanup();
        assert!(nat.entries.is_empty());
        assert!(nat.insert(flow, target.local_addr().unwrap().port(), None));
        nat.forget(flow);
        assert!(nat.entries.is_empty());
    }
}
