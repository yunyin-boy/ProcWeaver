#include "socket_hook.h"
#include "dns_hook.h"

PFN_connect TrueConnect = connect;
PFN_WSAConnect TrueWSAConnect = WSAConnect;
PFN_sendto TrueSendTo = sendto;
PFN_WSASendTo TrueWSASendTo = WSASendTo;
decltype(&::socket) TrueSocket = ::socket;
decltype(&::WSASocketA) TrueWSASocketA = ::WSASocketA;
decltype(&::WSASocketW) TrueWSASocketW = ::WSASocketW;

static bool RejectSocketFamily(int af) {
    if ((af == AF_INET || af == AF_INET6 || af == AF_UNSPEC || af == FROM_PROTOCOL_INFO) &&
        g_config.reject_all && IsHookEnabled()) {
        WSASetLastError(WSAEACCES);
        return true;
    }
    return false;
}

SOCKET WSAAPI HookSocket(int af, int type, int protocol) {
    if (RejectSocketFamily(af)) return INVALID_SOCKET;
    return TrueSocket(af, type, protocol);
}

SOCKET WSAAPI HookWSASocketA(int af, int type, int protocol, LPWSAPROTOCOL_INFOA info, GROUP group, DWORD flags) {
    if (RejectSocketFamily(af)) return INVALID_SOCKET;
    return TrueWSASocketA(af, type, protocol, info, group, flags);
}

SOCKET WSAAPI HookWSASocketW(int af, int type, int protocol, LPWSAPROTOCOL_INFOW info, GROUP group, DWORD flags) {
    if (RejectSocketFamily(af)) return INVALID_SOCKET;
    return TrueWSASocketW(af, type, protocol, info, group, flags);
}

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

static bool IsSuiteDnsAlias(uint32_t address) {
    return (ntohl(address) & 0xFFFF0000) == 0xC6130000;
}

static sockaddr_in SuiteDnsEndpoint() {
    sockaddr_in endpoint{};
    endpoint.sin_family = AF_INET;
    endpoint.sin_addr.s_addr = htonl(0xC6130001); // 198.19.0.1, terminates in the bundle inlet.
    endpoint.sin_port = htons(53);
    return endpoint;
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
        bool scoped_token = g_config.policy.scoped_dns && IsSuiteDnsAlias(sin->sin_addr.s_addr);
        if (g_config.policy.remote_dns_required && IsFakeIp(sin->sin_addr.s_addr) && !scoped_token
            && (fake_domain.empty() || fake_domain.length() > 255)) {
            return false; // A lost token must never become an IP request or native DNS fallback.
        }

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

bool ExchangeSuiteDns(const std::vector<uint8_t>& query, std::vector<uint8_t>& answer) {
    if (!g_config.policy.scoped_dns || !g_config.bundle_port || query.size() < 12 || query.size() > 65535) {
        return false;
    }
    WSADATA winsock{};
    if (WSAStartup(MAKEWORD(2, 2), &winsock) != 0) return false;
    SOCKET socket = TrueSocket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (socket == INVALID_SOCKET) {
        WSACleanup();
        return false;
    }
    sockaddr_in inlet{};
    inlet.sin_family = AF_INET;
    inlet.sin_port = htons(g_config.bundle_port);
    inlet.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    auto endpoint = SuiteDnsEndpoint();
    constexpr int timeout = 4200;
    unsigned char length[2] = {
        static_cast<unsigned char>(query.size() >> 8), static_cast<unsigned char>(query.size()),
    };
    bool ok = TrueConnect(socket, reinterpret_cast<sockaddr*>(&inlet), sizeof(inlet)) == 0
        && PerformSocks5Handshake(socket, reinterpret_cast<sockaddr*>(&endpoint), sizeof(endpoint))
        && SendExactTimeout(socket, reinterpret_cast<const char*>(length), sizeof(length), timeout)
        && SendExactTimeout(socket, reinterpret_cast<const char*>(query.data()), static_cast<int>(query.size()), timeout)
        && RecvExactTimeout(socket, reinterpret_cast<char*>(length), sizeof(length), timeout);
    if (ok) {
        answer.resize((static_cast<size_t>(length[0]) << 8) | length[1]);
        ok = answer.size() >= 12
            && RecvExactTimeout(socket, reinterpret_cast<char*>(answer.data()), static_cast<int>(answer.size()), timeout)
            && answer[0] == query[0] && answer[1] == query[1] && (answer[2] & 0x80) != 0;
    }
    closesocket(socket);
    WSACleanup();
    if (!ok) answer.clear();
    return ok;
}

static bool IsDnsEndpoint(const sockaddr* to) {
    if (!to) return false;
    if (to->sa_family == AF_INET) return reinterpret_cast<const sockaddr_in*>(to)->sin_port == htons(53);
    if (to->sa_family == AF_INET6) return reinterpret_cast<const sockaddr_in6*>(to)->sin6_port == htons(53);
    return false;
}

static bool UseNativeDns(const sockaddr* to) {
    if (g_config.policy.dns_mode != DnsMode::SystemNative || !IsDnsEndpoint(to)) return false;
    for (const auto& server : g_config.policy.native_dns_servers) {
        if (to->sa_family == AF_INET) {
            IN_ADDR ip{};
            if (InetPtonA(AF_INET, server.c_str(), &ip) == 1
                && ip.s_addr == reinterpret_cast<const sockaddr_in*>(to)->sin_addr.s_addr) return true;
        } else {
            IN6_ADDR ip{};
            if (InetPtonA(AF_INET6, server.c_str(), &ip) == 1
                && memcmp(&ip, &reinterpret_cast<const sockaddr_in6*>(to)->sin6_addr, sizeof(ip)) == 0) return true;
        }
    }
    return false;
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

    // Full-edition name tokens must go to their bundle inlet, including sandbox
    // fallback decisions. Sending the token natively cannot implement an exclusion.
    if (g_config.policy.remote_dns_required && name->sa_family == AF_INET
        && IsFakeIp(((const sockaddr_in*)name)->sin_addr.s_addr)) return false;

    // 协议策略：是否代理 TCP
    if (!g_config.policy.proxy_tcp) return true;

    if (name->sa_family == AF_INET) {
        const sockaddr_in* sin = (const sockaddr_in*)name;
        uint32_t ip = ntohl(sin->sin_addr.s_addr);
        uint16_t port = ntohs(sin->sin_port);

        // 127.0.0.1 (回环地址)
        if (ip == 0x7F000001 || (ip >> 24) == 127) {
            // 若连接的是 ProcWeaver 系统代理端口，绝不可旁路绕过，须改投到该规则专属 Mixed 入口
            bool is_sysproxy_port = (g_config.system_proxy_ports.find(port) != g_config.system_proxy_ports.end())
                && port != g_config.bundle_port;
            if (is_sysproxy_port) {
                return false;
            }
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
        uint16_t port = ntohs(sin6->sin6_port);
        const uint8_t* b = (const uint8_t*)&sin6->sin6_addr;
        bool is_loopback = true;
        for (int i = 0; i < 15; i++) {
            if (b[i] != 0) { is_loopback = false; break; }
        }
        if (is_loopback && b[15] == 1) {
            bool is_sysproxy_port = (g_config.system_proxy_ports.find(port) != g_config.system_proxy_ports.end())
                && port != g_config.bundle_port;
            if (is_sysproxy_port) {
                return false; // IPv6 回环代理请求同样不旁路，改投至专属出口！
            }
            return true;
        }
        return false;
    }
    return true;
}

static int RedirectToBundle(SOCKET s, const struct sockaddr *name, int namelen) {
    sockaddr_storage bundle_storage;
    memset(&bundle_storage, 0, sizeof(bundle_storage));
    int addr_len = sizeof(sockaddr_in);
    if (name && name->sa_family == AF_INET6) {
        sockaddr_in6* sin6 = (sockaddr_in6*)&bundle_storage;
        sin6->sin6_family = AF_INET6;
        sin6->sin6_port = htons(g_config.bundle_port);
        sin6->sin6_addr.s6_addr[15] = 1; // [::1]:bundle_port
        addr_len = sizeof(sockaddr_in6);
    } else {
        sockaddr_in* sin4 = (sockaddr_in*)&bundle_storage;
        sin4->sin_family = AF_INET;
        sin4->sin_port = htons(g_config.bundle_port);
        sin4->sin_addr.s_addr = htonl(INADDR_LOOPBACK); // 127.0.0.1:bundle_port
        addr_len = sizeof(sockaddr_in);
    }

    // 1. 发起与本机专属端口的底层连接
    int ret = TrueConnect(s, (sockaddr*)&bundle_storage, addr_len);
    if (ret != 0) {
        int err = WSAGetLastError();
        if (err == WSAEWOULDBLOCK || err == WSAEINPROGRESS) {
            // 对非阻塞套接字 (Chromium / Node.js)，使用 select 等待其与专属端口完成三次握手
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

    // 2. 检查是否为发往公共系统代理的连接（IPv4 或 IPv6 回环）：若是，连接专属 Mixed 入口后直接返回，
    // 保留客户端后续原生的 HTTP CONNECT / SOCKS 请求，绝不再套一层 SOCKS 握手！
    if (name) {
        if (name->sa_family == AF_INET) {
            const sockaddr_in* sin = (const sockaddr_in*)name;
            uint32_t ip = ntohl(sin->sin_addr.s_addr);
            if ((ip == 0x7F000001 || (ip >> 24) == 127) && ntohs(sin->sin_port) != g_config.bundle_port) {
                return 0;
            }
        } else if (name->sa_family == AF_INET6) {
            const sockaddr_in6* sin6 = (const sockaddr_in6*)name;
            const uint8_t* b = (const uint8_t*)&sin6->sin6_addr;
            bool is_loopback = true;
            for (int i = 0; i < 15; i++) {
                if (b[i] != 0) { is_loopback = false; break; }
            }
            if (is_loopback && b[15] == 1 && ntohs(sin6->sin6_port) != g_config.bundle_port) {
                return 0;
            }
        }
    }

    // 3. 透明外网连接：执行 SOCKS5 握手 (基于 select 超时驱动，无论阻塞还是非阻塞套接字均能原子完成)
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
    if (!to || !IsHookEnabled()) return false;
    if (UseNativeDns(to)) return false;
    if (g_config.policy.remote_dns_required && to->sa_family == AF_INET
        && IsFakeIp(((const sockaddr_in*)to)->sin_addr.s_addr)) return true;

    // 禁止 UDP 策略（最高优先级 · 防 QUIC / WebRTC 泄露）
    if (g_config.policy.block_udp || g_config.policy.remote_dns_required) {
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

static int ConnectSuiteDns(SOCKET socket, const sockaddr* name) {
    int type = 0;
    int length = sizeof(type);
    if (name->sa_family != AF_INET
        || getsockopt(socket, SOL_SOCKET, SO_TYPE, reinterpret_cast<char*>(&type), &length) != 0
        || type != SOCK_STREAM) {
        WSASetLastError(WSAEACCES);
        return SOCKET_ERROR;
    }
    auto endpoint = SuiteDnsEndpoint();
    return RedirectToBundle(socket, reinterpret_cast<const sockaddr*>(&endpoint), sizeof(endpoint));
}

int WSAAPI HookConnect(
    SOCKET s,
    const struct sockaddr *name,
    int namelen
) {
    ReentryGuard guard;
    if (guard.is_reentrant || !IsHookEnabled()) {
        return TrueConnect(s, name, namelen);
    }

    if (g_config.reject_all) {
        WSASetLastError(WSAECONNREFUSED);
        return SOCKET_ERROR;
    }

    if (g_config.bundle_port == 0) {
        return TrueConnect(s, name, namelen);
    }
    if (UseNativeDns(name)) return TrueConnect(s, name, namelen);
    if (g_config.policy.scoped_dns && IsDnsEndpoint(name)) return ConnectSuiteDns(s, name);

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
    if (guard.is_reentrant || !IsHookEnabled()) {
        return TrueWSAConnect(s, name, namelen, lpCallerData, lpCalleeData, lpSQOS, lpGQOS);
    }

    if (g_config.reject_all) {
        WSASetLastError(WSAECONNREFUSED);
        return SOCKET_ERROR;
    }

    if (g_config.bundle_port == 0) {
        return TrueWSAConnect(s, name, namelen, lpCallerData, lpCalleeData, lpSQOS, lpGQOS);
    }
    if (UseNativeDns(name)) return TrueWSAConnect(s, name, namelen, lpCallerData, lpCalleeData, lpSQOS, lpGQOS);
    if (g_config.policy.scoped_dns && IsDnsEndpoint(name)) return ConnectSuiteDns(s, name);

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
    if (guard.is_reentrant || !IsHookEnabled()) return TrueSendTo(s, buf, len, flags, to, tolen);
    if (g_config.reject_all) {
        WSASetLastError(WSAECONNRESET);
        return SOCKET_ERROR;
    }
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
    if (guard.is_reentrant || !IsHookEnabled()) return TrueWSASendTo(s, lpBuffers, dwBufferCount, lpNumberOfBytesSent, dwFlags, lpTo, iTolen, lpOverlapped, lpCompletionRoutine);
    if (g_config.reject_all) {
        WSASetLastError(WSAECONNRESET);
        return SOCKET_ERROR;
    }
    if (ShouldBlockUdp(lpTo)) {
        WSASetLastError(WSAECONNRESET);
        return SOCKET_ERROR;
    }
    return TrueWSASendTo(s, lpBuffers, dwBufferCount, lpNumberOfBytesSent, dwFlags, lpTo, iTolen, lpOverlapped, lpCompletionRoutine);
}
