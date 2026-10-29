//! 微秒级 TCP 协议栈长连接热重置与存量扫描组件 (Windows Native)
//! 基于 iphlpapi!GetExtendedTcpTable 与 iphlpapi!SetTcpEntry (MIB_TCP_STATE_DELETE_TCB)

use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;

/// 存量 TCP 连接信息（脱敏传递给前端进行展示与确认）
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StaleTcpConnection {
    pub pid: u32,
    pub process_name: String,
    pub local_address: String,
    pub local_port: u16,
    pub remote_address: String,
    pub remote_port: u16,
    pub state: String,
    pub is_target: bool,
    pub target_category: String,
    pub destination_label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetStaleResult {
    pub total_scanned: usize,
    pub total_reset: usize,
    pub failed_count: usize,
    pub details: Vec<String>,
}

#[cfg(windows)]
mod sys {
    use std::ffi::c_void;

    const AF_INET: u32 = 2;
    const TCP_TABLE_OWNER_PID_ALL: i32 = 5;
    pub const MIB_TCP_STATE_ESTAB: u32 = 5;
    pub const MIB_TCP_STATE_DELETE_TCB: u32 = 12;

    #[repr(C)]
    #[derive(Copy, Clone, Debug)]
    pub struct MIB_TCPROW_OWNER_PID {
        pub dw_state: u32,
        pub dw_local_addr: u32,
        pub dw_local_port: u32,
        pub dw_remote_addr: u32,
        pub dw_remote_port: u32,
        pub dw_owning_pid: u32,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Debug)]
    pub struct MIB_TCPROW {
        pub dw_state: u32,
        pub dw_local_addr: u32,
        pub dw_local_port: u32,
        pub dw_remote_addr: u32,
        pub dw_remote_port: u32,
    }

    #[link(name = "iphlpapi")]
    extern "system" {
        fn GetExtendedTcpTable(
            pTcpTable: *mut c_void,
            pdwSize: *mut u32,
            bOrder: i32,
            ulAf: u32,
            TableClass: i32,
            Reserved: u32,
        ) -> u32;

        fn SetTcpEntry(pTcpRow: *mut MIB_TCPROW) -> u32;
    }

    /// 读取系统所有 IPv4 TCP 连接表
    pub fn get_tcp_table_owner_pid() -> Result<Vec<MIB_TCPROW_OWNER_PID>, String> {
        let mut size: u32 = 0;
        unsafe {
            // 第一次调用以获取所需缓冲区大小
            let _ = GetExtendedTcpTable(
                std::ptr::null_mut(),
                &mut size,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            );
        }

        if size == 0 {
            return Ok(Vec::new());
        }

        let mut buffer: Vec<u8> = vec![0; size as usize];
        let ret = unsafe {
            GetExtendedTcpTable(
                buffer.as_mut_ptr() as *mut c_void,
                &mut size,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            )
        };

        if ret != 0 {
            return Err(format!("GetExtendedTcpTable 调用失败，错误码: {ret}"));
        }

        // 缓冲区前 4 字节为 dwNumEntries
        if buffer.len() < 4 {
            return Ok(Vec::new());
        }

        let num_entries = u32::from_ne_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]) as usize;
        let row_size = std::mem::size_of::<MIB_TCPROW_OWNER_PID>();
        let mut entries = Vec::with_capacity(num_entries);

        let data_start = 4;
        for i in 0..num_entries {
            let offset = data_start + i * row_size;
            if offset + row_size <= buffer.len() {
                let row_ptr = buffer[offset..].as_ptr() as *const MIB_TCPROW_OWNER_PID;
                let row = unsafe { *row_ptr };
                entries.push(row);
            }
        }

        Ok(entries)
    }

    /// 对指定的四元组 TCP 连接执行 DELETE_TCB（微秒级重置）
    pub fn kill_tcp_entry(
        local_ip: u32,
        local_port_net_order: u32,
        remote_ip: u32,
        remote_port_net_order: u32,
    ) -> Result<(), String> {
        let mut row = MIB_TCPROW {
            dw_state: MIB_TCP_STATE_DELETE_TCB,
            dw_local_addr: local_ip,
            dw_local_port: local_port_net_order,
            dw_remote_addr: remote_ip,
            dw_remote_port: remote_port_net_order,
        };

        let ret = unsafe { SetTcpEntry(&mut row) };
        if ret == 0 {
            Ok(())
        } else {
            Err(format!("SetTcpEntry 失败，错误码: {ret}"))
        }
    }
}

/// 扫描指定 PID 列表名下的存量活跃长连接
pub fn scan_stale_tcp_connections(
    target_pids: &[u32],
    bundle_port: u16,
) -> Result<Vec<StaleTcpConnection>, String> {
    #[cfg(windows)]
    {
        use sys::*;
        let table = get_tcp_table_owner_pid()?;
        let mut results = Vec::new();

        for row in table {
            if !target_pids.contains(&row.dw_owning_pid) {
                continue;
            }

            // 只关心 ESTABLISHED 状态的连接
            if row.dw_state != MIB_TCP_STATE_ESTAB {
                continue;
            }

            // 端口转换 (低 16 位按网络字节序存储)
            let local_port = u16::from_be((row.dw_local_port & 0xFFFF) as u16);
            let remote_port = u16::from_be((row.dw_remote_port & 0xFFFF) as u16);

            let local_ip = Ipv4Addr::from(u32::from_be(row.dw_local_addr));
            let remote_ip = Ipv4Addr::from(u32::from_be(row.dw_remote_addr));

            // 如果该连接的目标端口已经是当前规则包的代理端口（127.0.0.1:bundle_port），说明已经走代理，无需重置
            if remote_ip.is_loopback() && remote_port == bundle_port {
                continue;
            }

            // 忽略回环到回环的本地 IPC 通信
            if local_ip.is_loopback() && remote_ip.is_loopback() {
                continue;
            }

            let (is_target, target_category, destination_label) = classify_destination(remote_ip);

            results.push(StaleTcpConnection {
                pid: row.dw_owning_pid,
                process_name: get_process_name_by_pid(row.dw_owning_pid),
                local_address: local_ip.to_string(),
                local_port,
                remote_address: remote_ip.to_string(),
                remote_port,
                state: "ESTABLISHED".into(),
                is_target,
                target_category,
                destination_label,
            });
        }

        Ok(results)
    }

    #[cfg(not(windows))]
    {
        let _ = (target_pids, bundle_port);
        Ok(Vec::new())
    }
}

/// 启发式目标感知分类器：区分 Fake-IP 业务目标、海外公网服务与国内直连通道
pub fn classify_destination(remote_ip: Ipv4Addr) -> (bool, String, String) {
    let octets = remote_ip.octets();

    // 1. Fake-IP (198.18.0.0/15) - 100% 规则包海外业务目标
    if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) {
        return (true, "fake_ip".into(), "Fake-IP (业务目标)".into());
    }

    // 2. 常见国内主流公共 DNS 与国内骨干 IP 段判定
    let is_domestic = matches!(
        octets,
        [223, 5 | 6, ..] | // 阿里 DNS / 阿里公网
        [119, 29, ..] |    // 腾讯 DNS / 腾讯云
        [114, 114, 114, 114] | [114, 114, 115, 115] |
        [180, 76, 76, 76] | // 百度 DNS
        [101, 226, ..] |   // 腾讯云常用段
        [120, 24..=55, ..] | // 阿里云华东/华南常用段
        [121, 14..=51, ..] |
        [123, 120..=126, ..]
    );

    if is_domestic {
        return (false, "domestic".into(), "国内直连通道 (建议保留)".into());
    }

    // 3. 常见海外公共服务 / DNS
    let is_overseas_common = matches!(
        octets,
        [8, 8, 8 | 4, _] |     // Google DNS
        [1, 1, 1, 1] | [1, 0, 0, 1] | // Cloudflare DNS
        [9, 9, 9, 9] |         // Quad9
        [208, 67, 222 | 220, _] // OpenDNS
    );

    if is_overseas_common {
        return (true, "overseas".into(), "海外公共服务".into());
    }

    // 4. 默认公网连接在跨境规则包下作为远端目标对待
    (true, "overseas".into(), "海外/远端目标".into())
}

/// 对给定的存量连接列表执行微秒级重置 (TCP RST)
pub fn reset_stale_tcp_connections(connections: &[StaleTcpConnection]) -> ResetStaleResult {
    let mut total_reset = 0;
    let mut failed_count = 0;
    let mut details = Vec::new();

    #[cfg(windows)]
    {
        use sys::*;
        for conn in connections {
            let local_ip: Ipv4Addr = match conn.local_address.parse() {
                Ok(ip) => ip,
                Err(_) => {
                    failed_count += 1;
                    continue;
                }
            };
            let remote_ip: Ipv4Addr = match conn.remote_address.parse() {
                Ok(ip) => ip,
                Err(_) => {
                    failed_count += 1;
                    continue;
                }
            };

            let local_ip_raw = u32::from_ne_bytes(local_ip.octets());
            let remote_ip_raw = u32::from_ne_bytes(remote_ip.octets());
            let local_port_net = (conn.local_port.to_be() as u32) & 0xFFFF;
            let remote_port_net = (conn.remote_port.to_be() as u32) & 0xFFFF;

            match kill_tcp_entry(local_ip_raw, local_port_net, remote_ip_raw, remote_port_net) {
                Ok(_) => {
                    total_reset += 1;
                    details.push(format!(
                        "成功重置 PID: {} [{}:{}] -> [{}:{}]",
                        conn.pid, conn.local_address, conn.local_port, conn.remote_address, conn.remote_port
                    ));
                }
                Err(err) => {
                    failed_count += 1;
                    details.push(format!(
                        "重置失败 PID: {} [{}:{}] -> [{}:{}]: {}",
                        conn.pid, conn.local_address, conn.local_port, conn.remote_address, conn.remote_port, err
                    ));
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = connections;
    }

    ResetStaleResult {
        total_scanned: connections.len(),
        total_reset,
        failed_count,
        details,
    }
}

fn get_process_name_by_pid(pid: u32) -> String {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };

        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return format!("PID:{pid}");
            }

            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                cntUsage: 0,
                th32ProcessID: 0,
                th32DefaultHeapID: 0,
                th32ModuleID: 0,
                cntThreads: 0,
                th32ParentProcessID: 0,
                pcPriClassBase: 0,
                dwFlags: 0,
                szExeFile: [0; 260],
            };

            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    if entry.th32ProcessID == pid {
                        CloseHandle(snap);
                        let name_len = entry
                            .szExeFile
                            .iter()
                            .position(|&c| c == 0)
                            .unwrap_or(entry.szExeFile.len());
                        return String::from_utf16_lossy(&entry.szExeFile[..name_len]);
                    }
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
    }
    format!("PID:{pid}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stale_tcp_struct_serialization() {
        let conn = StaleTcpConnection {
            pid: 1234,
            process_name: "test.exe".into(),
            local_address: "127.0.0.1".into(),
            local_port: 54321,
            remote_address: "142.250.190.46".into(),
            remote_port: 443,
            state: "ESTABLISHED".into(),
            is_target: true,
            target_category: "overseas".into(),
            destination_label: "海外/远端目标".into(),
        };

        let json = serde_json::to_string(&conn).unwrap();
        assert!(json.contains("\"processName\":\"test.exe\""));
        assert!(json.contains("\"remotePort\":443"));
        assert!(json.contains("\"isTarget\":true"));

        let de: StaleTcpConnection = serde_json::from_str(&json).unwrap();
        assert_eq!(de.pid, 1234);
        assert!(de.is_target);
    }

    #[test]
    fn test_classify_destination_targets() {
        let fake = "198.18.0.25".parse::<Ipv4Addr>().unwrap();
        let (is_t, cat, label) = classify_destination(fake);
        assert!(is_t);
        assert_eq!(cat, "fake_ip");
        assert!(label.contains("Fake-IP"));

        let domestic = "223.5.5.5".parse::<Ipv4Addr>().unwrap();
        let (is_t, cat, label) = classify_destination(domestic);
        assert!(!is_t);
        assert_eq!(cat, "domestic");
        assert!(label.contains("建议保留"));

        let google = "8.8.8.8".parse::<Ipv4Addr>().unwrap();
        let (is_t, cat, _) = classify_destination(google);
        assert!(is_t);
        assert_eq!(cat, "overseas");
    }
}
