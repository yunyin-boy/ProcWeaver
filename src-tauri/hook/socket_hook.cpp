#include "socket_hook.h"
#include "dns_hook.h"

PFN_connect TrueConnect = connect;
PFN_WSAConnect TrueWSAConnect = WSAConnect;
PFN_sendto TrueSendTo = sendto;
PFN_WSASendTo TrueWSASendTo = WSASendTo;

// 基于 select 超时机制的精确发送，原生兼容阻塞与非阻塞 (Non-blocking) 套接字
static bool SendExactTimeout(SOCKET s, const char* buf, int len, int timeout_ms) {
    int total = 0;
    while (total < len) {
        fd_set wfds, efds;
        FD_ZERO(&wfds); FD_ZERO(&efds);
        FD_SET(s, &wfds); FD_SET(s, &efds);
        timeval tv;
        tv.tv_sec = timeout_ms / 1000;
        tv.tv_usec = (timeout_ms % 1000) * 1000;

        int sel = select((int)s + 1, nullptr, &wfds, &efds, &tv);
        if (sel <= 0 || FD_ISSET(s, &efds)) return false;

        int n = send(s, buf + total, len - total, 0);
        if (n <= 0) return false;
        total += n;
    }
    return true;
}

// 基于 select 超时机制的精确接收，原生兼容阻塞与非阻塞 (Non-blocking) 套接字
static bool RecvExactTimeout(SOCKET s, char* buf, int len, int timeout_ms) {
    int total = 0;
    while (total < len) {
        fd_set rfds, efds;
        FD_ZERO(&rfds); FD_ZERO(&efds);
        FD_SET(s, &rfds); FD_SET(s, &efds);
        timeval tv;
        tv.tv_sec = timeout_ms / 1000;
        tv.tv_usec = (timeout_ms % 1000) * 1000;

        int sel = select((int)s + 1, &rfds, nullptr, &efds, &tv);
        if (sel <= 0 || FD_ISSET(s, &efds)) return false;

        int n = recv(s, buf + total, len - total, 0);
        if (n <= 0) return false;
        total += n;
    }
    return true;
}

static bool PerformSocks5Handshake(SOCKET s, const struct sockaddr *orig_addr, int orig_len) {
    (void)orig_len;
    if (!orig_addr || (orig_addr->sa_family != AF_INET && orig_addr->sa_family != AF_INET6)) {
        return false;
    }

    const int TIMEOUT_MS = 2500; // 本地回环握手 2.5 秒超时

    // 1. 发送方法协商: 0x05 (VER), 0x01 (NMETHODS), 0x00 (NO AUTH)
    char auth_req[] = { 0x05, 0x01, 0x00 };
    if (!SendExactTimeout(s, auth_req, sizeof(auth_req), TIMEOUT_MS)) {
        return false;
    }

    // 2. 接收响应: 0x05, 0x00
    char auth_resp[2] = { 0 };
    if (!RecvExactTimeout(s, auth_resp, 2, TIMEOUT_MS)) {
        return false;
    }
    if (auth_resp[0] != 0x05 || auth_resp[1] != 0x00) {
        return false;
    }

    // 3. 构造并发送 CONNECT 请求
    if (orig_addr->sa_family == AF_INET) {
        const sockaddr_in* sin = (const sockaddr_in*)orig_addr;
        std::string fake_domain = GetDomainForFakeIp(sin->sin_addr.s_addr);

        if (!fake_domain.empty() && fake_domain.length() <= 255) {
            // Fake-IP 模式：发送 SOCKS5 ATYP=0x03 原始域名报文，由远端代理节点解析
            uint8_t dlen = (uint8_t)fake_domain.length();
            int req_len = 5 + dlen + 2;
            std::vector<char> req(req_len);
            req[0] = 0x05; // VER
            req[1] = 0x01; // CMD: CONNECT
            req[2] = 0x00; // RSV
            req[3] = 0x03; // ATYP: DOMAIN
            req[4] = dlen;
            memcpy(&req[5], fake_domain.data(), dlen);
            memcpy(&req[5 + dlen], &sin->sin_port, 2);

            if (!SendExactTimeout(s, req.data(), req_len, TIMEOUT_MS)) {
                return false;
            }
        } else {
            // 标准 IPv4 CONNECT (ATYP=0x01)
            char req[10];
            req[0] = 0x05; // VER
            req[1] = 0x01; // CMD: CONNECT
            req[2] = 0x00; // RSV
            req[3] = 0x01; // ATYP: IPv4
            memcpy(&req[4], &sin->sin_addr.s_addr, 4);
            memcpy(&req[8], &sin->sin_port, 2);

            if (!SendExactTimeout(s, req, 10, TIMEOUT_MS)) {
                return false;
            }
        }
    } else {
        const sockaddr_in6* sin6 = (const sockaddr_in6*)orig_addr;
        char req[22];
        req[0] = 0x05;
        req[1] = 0x01;
        req[2] = 0x00;
        req[3] = 0x04; // ATYP: IPv6
        memcpy(&req[4], &sin6->sin6_addr, 16);
        memcpy(&req[20], &sin6->sin6_port, 2);

        if (!SendExactTimeout(s, req, 22, TIMEOUT_MS)) {
            return false;
        }
    }

    // 4. 接收 CONNECT 响应头
    char resp_header[4] = { 0 };
    if (!RecvExactTimeout(s, resp_header, 4, TIMEOUT_MS)) {
        return false;
    }
    if (resp_header[0] != 0x05 || resp_header[1] != 0x00) {
        // REP != 0x00 表示连接远程目标失败
        return false;
    }

    // 5. 消费掉 SOCKS5 服务器返回的 BND.ADDR 和 BND.PORT
    uint8_t atyp = (uint8_t)resp_header[3];
    int remain_len = 0;
    if (atyp == 0x01) {
        remain_len = 4 + 2; // 4 bytes IPv4 + 2 bytes port
    } else if (atyp == 0x04) {
        remain_len = 16 + 2; // 16 bytes IPv6 + 2 bytes port
    } else if (atyp == 0x03) {
        char domain_len = 0;
        if (!RecvExactTimeout(s, &domain_len, 1, TIMEOUT_MS)) return false;
        remain_len = ((uint8_t)domain_len) + 2;
    } else {
        return false;
    }

    std::vector<char> dummy(remain_len);
    if (!RecvExactTimeout(s, dummy.data(), remain_len, TIMEOUT_MS)) {
        return false;
    }

    return true;
}

static bool MatchTargetDomain(const std::string& domain, const std::string& rule) {
    if (rule.empty() || domain.empty()) return false;
    if (_stricmp(domain.c_str(), rule.c_str()) == 0) return true;
    if (rule[0] == '.') {
        if (domain.length() >= rule.length()) {
            size_t offset = domain.length() - rule.length();
            return _stricmp(domain.c_str() + offset, rule.c_str()) == 0;
        }
    } else if (rule.rfind("*.", 0) == 0) {
        std::string suffix = rule.substr(1);
        if (domain.length() >= suffix.length()) {
            size_t offset = domain.length() - suffix.length();
            return _stricmp(domain.c_str() + offset, suffix.c_str()) == 0;
        }
    }
    return false;
}

static bool ShouldBypass(const struct sockaddr *name) {
    if (!name) return true;
    if (g_config.bundle_port == 0) return true;

    // 协议策略：是否代理 TCP
    if (!g_config.policy.proxy_tcp) return true;

    if (name->sa_family == AF_INET) {
        const sockaddr_in* sin = (const sockaddr_in*)name;
        uint32_t ip = ntohl(sin->sin_addr.s_addr);
        uint16_t port = ntohs(sin->sin_port);

        // 127.0.0.1 (回环地址)
        if (ip == 0x7F000001 || (ip >> 24) == 127 || port == g_config.bundle_port || port == g_config.dns_port) {
            return true;
        }

        // Fake-IP 判断：Fake-IP 代表被拦截的真实外网域名，绝不按 LAN 绕过！
        bool is_fake = IsFakeIp(sin->sin_addr.s_addr);
        std::string fake_domain = is_fake ? GetDomainForFakeIp(sin->sin_addr.s_addr) : "";

        if (!is_fake && g_config.policy.bypass_lan) {
            // RFC 1918 局域网私有地址段放行
            if ((ip >> 24) == 10) return true;                          // 10.0.0.0/8
            if ((ip >> 20) == (0xAC100000 >> 20)) return true;          // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
            if ((ip >> 16) == 0xC0A8) return true;                      // 192.168.0.0/16
            if ((ip >> 16) == 0xA9FE) return true;                      // 169.254.0.0/16 (Link-local)
        }

        // 端口过滤策略
        if (g_config.policy.port_filter_mode == PortFilterMode::WebOnly) {
            if (port != 80 && port != 443) return true; // 仅代理 80 和 443
        } else if (g_config.policy.port_filter_mode == PortFilterMode::Custom) {
            if (g_config.policy.custom_ports.find(port) == g_config.policy.custom_ports.end()) {
                return true; // 不在自定义端口列表中
            }
        }

        // 目标域名 / IP 过滤策略 (特别对独立进程版意义重大)
        if (g_config.policy.target_filter_mode != TargetFilterMode::All && !fake_domain.empty()) {
            bool matched = false;
            for (const auto& rule : g_config.policy.target_rules) {
                if (MatchTargetDomain(fake_domain, rule)) {
                    matched = true;
                    break;
                }
            }
            if (g_config.policy.target_filter_mode == TargetFilterMode::Include) {
                if (!matched) return true; // 仅代理包含目标：未命中则直连绕过
            } else if (g_config.policy.target_filter_mode == TargetFilterMode::Exclude) {
                if (matched) return true;  // 排除指定目标：命中则直连绕过
            }
        }

        return false;
    } else if (name->sa_family == AF_INET6) {
        const sockaddr_in6* sin6 = (const sockaddr_in6*)name;
        const uint8_t* b = (const uint8_t*)&sin6->sin6_addr;
        bool is_loopback = true;
        for (int i = 0; i < 15; i++) {
            if (b[i] != 0) { is_loopback = false; break; }
        }
        if (is_loopback && b[15] == 1) {
            return true;
        }
        return false;
    }
    return true;
}

static int RedirectToBundle(SOCKET s, const struct sockaddr *name, int namelen) {
    sockaddr_in bundle_addr;
    memset(&bundle_addr, 0, sizeof(bundle_addr));
    bundle_addr.sin_family = AF_INET;
    bundle_addr.sin_port = htons(g_config.bundle_port);
    bundle_addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); // 127.0.0.1

    // 1. 发起与本机 127.0.0.1:bundle_port 的底层连接
    int ret = TrueConnect(s, (sockaddr*)&bundle_addr, sizeof(bundle_addr));
    if (ret != 0) {
        int err = WSAGetLastError();
        if (err == WSAEWOULDBLOCK || err == WSAEINPROGRESS) {
            // 对非阻塞套接字 (Chromium / Node.js)，使用 select 等待其与 127.0.0.1:bundle_port 完成三次握手
            fd_set wfds, efds;
            FD_ZERO(&wfds); FD_ZERO(&efds);
            FD_SET(s, &wfds); FD_SET(s, &efds);
            timeval tv = { 1, 500000 }; // 1.5 秒超时
            int sel = select((int)s + 1, nullptr, &wfds, &efds, &tv);
            if (sel <= 0 || FD_ISSET(s, &efds)) {
                WSASetLastError(WSAECONNREFUSED);
                return SOCKET_ERROR;
            }
            int so_error = 0;
            int optlen = sizeof(so_error);
            getsockopt(s, SOL_SOCKET, SO_ERROR, (char*)&so_error, &optlen);
            if (so_error != 0) {
                WSASetLastError(so_error);
                return SOCKET_ERROR;
            }
        } else {
            return ret; // 物理连接失败
        }
    }

    // 2. 执行透明 SOCKS5 握手 (基于 select 超时驱动，无论阻塞还是非阻塞套接字均能原子完成)
    bool ok = PerformSocks5Handshake(s, name, namelen);
    if (!ok) {
        WSASetLastError(WSAECONNREFUSED);
        return SOCKET_ERROR;
    }

    // 3. 握手完全成功！此时客户端与 mihomo 之间的 SOCKS5 隧道已建立就绪。
    // 根据 POSIX / Winsock 规范，当非阻塞连接在系统调用返回前已就绪时返回 0 是合法标准行为。
    return 0;
}

static bool IsQuicOrUdp443(const struct sockaddr *to) {
    if (!to) return false;
    if (to->sa_family == AF_INET) {
        const sockaddr_in* sin = (const sockaddr_in*)to;
        if (ntohs(sin->sin_port) == 443) {
            uint32_t ip = ntohl(sin->sin_addr.s_addr);
            if (ip != 0x7F000001 && (ip >> 24) != 127) {
                return true;
            }
        }
    } else if (to->sa_family == AF_INET6) {
        const sockaddr_in6* sin6 = (const sockaddr_in6*)to;
        if (ntohs(sin6->sin6_port) == 443) {
            return true;
        }
    }
    return false;
}

static bool ShouldBlockUdp(const struct sockaddr *to) {
    if (!to || !g_config.enabled) return false;

    // 禁止 UDP 策略（最高优先级 · 防 QUIC / WebRTC 泄露）
    if (g_config.policy.block_udp) {
        if (to->sa_family == AF_INET) {
            const sockaddr_in* sin = (const sockaddr_in*)to;
            uint32_t ip = ntohl(sin->sin_addr.s_addr);
            if (ip == 0x7F000001 || (ip >> 24) == 127) return false; // 本地回环放行
            return true; // 阻断所有外网 UDP
        } else if (to->sa_family == AF_INET6) {
            return true;
        }
    }

    // 默认防 QUIC 探测
    return IsQuicOrUdp443(to);
}

int WSAAPI HookConnect(
    SOCKET s,
    const struct sockaddr *name,
    int namelen
) {
    ReentryGuard guard;
    if (guard.is_reentrant || !g_config.enabled || g_config.bundle_port == 0) {
        return TrueConnect(s, name, namelen);
    }

    // 阻止 IPv6：阻断所有外网 IPv6 连接
    if (g_config.policy.block_ipv6 && name && name->sa_family == AF_INET6) {
        const sockaddr_in6* sin6 = (const sockaddr_in6*)name;
        const uint8_t* b = (const uint8_t*)&sin6->sin6_addr;
        bool is_loopback = true;
        for (int i = 0; i < 15; i++) {
            if (b[i] != 0) { is_loopback = false; break; }
        }
        if (!(is_loopback && b[15] == 1)) {
            WSASetLastError(WSAEHOSTUNREACH);
            return SOCKET_ERROR;
        }
    }

    if (ShouldBypass(name)) {
        return TrueConnect(s, name, namelen);
    }
    return RedirectToBundle(s, name, namelen);
}

int WSAAPI HookWSAConnect(
    SOCKET s,
    const struct sockaddr *name,
    int namelen,
    LPWSABUF lpCallerData,
    LPWSABUF lpCalleeData,
    LPQOS lpSQOS,
    LPQOS lpGQOS
) {
    ReentryGuard guard;
    if (guard.is_reentrant || !g_config.enabled || g_config.bundle_port == 0) {
        return TrueWSAConnect(s, name, namelen, lpCallerData, lpCalleeData, lpSQOS, lpGQOS);
    }

    if (g_config.policy.block_ipv6 && name && name->sa_family == AF_INET6) {
        const sockaddr_in6* sin6 = (const sockaddr_in6*)name;
        const uint8_t* b = (const uint8_t*)&sin6->sin6_addr;
        bool is_loopback = true;
        for (int i = 0; i < 15; i++) {
            if (b[i] != 0) { is_loopback = false; break; }
        }
        if (!(is_loopback && b[15] == 1)) {
            WSASetLastError(WSAEHOSTUNREACH);
            return SOCKET_ERROR;
        }
    }

    if (ShouldBypass(name)) {
        return TrueWSAConnect(s, name, namelen, lpCallerData, lpCalleeData, lpSQOS, lpGQOS);
    }
    return RedirectToBundle(s, name, namelen);
}

int WSAAPI HookSendTo(
    SOCKET s,
    const char *buf,
    int len,
    int flags,
    const struct sockaddr *to,
    int tolen
) {
    ReentryGuard guard;
    if (guard.is_reentrant) return TrueSendTo(s, buf, len, flags, to, tolen);
    if (ShouldBlockUdp(to)) {
        // 快速拒绝 UDP 探测或非代理 UDP，使客户端/浏览器 0 延迟秒切 TCP HTTP/2
        WSASetLastError(WSAECONNRESET);
        return SOCKET_ERROR;
    }
    return TrueSendTo(s, buf, len, flags, to, tolen);
}

int WSAAPI HookWSASendTo(
    SOCKET s,
    LPWSABUF lpBuffers,
    DWORD dwBufferCount,
    LPDWORD lpNumberOfBytesSent,
    DWORD dwFlags,
    const struct sockaddr *lpTo,
    int iTolen,
    LPWSAOVERLAPPED lpOverlapped,
    LPWSAOVERLAPPED_COMPLETION_ROUTINE lpCompletionRoutine
) {
    ReentryGuard guard;
    if (guard.is_reentrant) return TrueWSASendTo(s, lpBuffers, dwBufferCount, lpNumberOfBytesSent, dwFlags, lpTo, iTolen, lpOverlapped, lpCompletionRoutine);
    if (ShouldBlockUdp(lpTo)) {
        WSASetLastError(WSAECONNRESET);
        return SOCKET_ERROR;
    }
    return TrueWSASendTo(s, lpBuffers, dwBufferCount, lpNumberOfBytesSent, dwFlags, lpTo, iTolen, lpOverlapped, lpCompletionRoutine);
}
