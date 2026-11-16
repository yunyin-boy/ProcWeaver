#include "dns_hook.h"
#include <unordered_map>

PFN_getaddrinfo TrueGetAddrInfo = getaddrinfo;
PFN_GetAddrInfoW TrueGetAddrInfoW = GetAddrInfoW;
PFN_freeaddrinfo TrueFreeAddrInfo = freeaddrinfo;
PFN_FreeAddrInfoW TrueFreeAddrInfoW = FreeAddrInfoW;
decltype(&gethostbyname) TrueGetHostByName = gethostbyname;
decltype(&GetAddrInfoExA) TrueGetAddrInfoExA = GetAddrInfoExA;
decltype(&GetAddrInfoExW) TrueGetAddrInfoExW = GetAddrInfoExW;
decltype(&FreeAddrInfoExA) TrueFreeAddrInfoExA = FreeAddrInfoExA;
decltype(&FreeAddrInfoExW) TrueFreeAddrInfoExW = FreeAddrInfoExW;
decltype(&DnsQuery_A) TrueDnsQueryA = DnsQuery_A;
decltype(&DnsQuery_W) TrueDnsQueryW = DnsQuery_W;
decltype(&DnsQuery_UTF8) TrueDnsQueryUtf8 = DnsQuery_UTF8;
decltype(&DnsQueryEx) TrueDnsQueryEx = DnsQueryEx;

static std::unordered_set<void*> g_custom_ai_set;
static std::mutex g_custom_ai_mutex;

// Fake-IP 映射存储 (198.18.0.0/15)
static std::unordered_map<uint32_t, std::string> g_fake_ip_to_domain;
static std::unordered_map<std::string, uint32_t> g_domain_to_fake_ip;
static std::mutex g_fake_ip_mutex;
static uint32_t g_next_fake_ip = 0xC6120002; // 198.18.0.2 (主机序)

bool IsFakeIp(uint32_t net_ip) {
    uint32_t host_ip = ntohl(net_ip);
    // 198.18.0.0/15: 198.18.0.0 ~ 198.19.255.255
    return (host_ip & 0xFFFE0000) == 0xC6120000;
}

std::string GetDomainForFakeIp(uint32_t net_ip) {
    uint32_t host_ip = ntohl(net_ip);
    std::lock_guard<std::mutex> lock(g_fake_ip_mutex);
    auto it = g_fake_ip_to_domain.find(host_ip);
    if (it != g_fake_ip_to_domain.end()) {
        return it->second;
    }
    return "";
}

uint32_t AllocateFakeIpForDomain(const std::string& domain) {
    std::lock_guard<std::mutex> lock(g_fake_ip_mutex);
    auto it = g_domain_to_fake_ip.find(domain);
    if (it != g_domain_to_fake_ip.end()) {
        return htonl(it->second);
    }

    // Never reuse an address while an application may still cache the old name.
    if (g_next_fake_ip >= 0xC613FFFE) {
        if (g_config.policy.remote_dns_required) return 0;
        g_next_fake_ip = 0xC6120002; // Preserve the independent product's existing pool policy.
    }
    uint32_t host_ip = g_next_fake_ip++;

    g_fake_ip_to_domain[host_ip] = domain;
    g_domain_to_fake_ip[domain] = host_ip;
    return htonl(host_ip);
}

static bool IsLocalOrIp(const char* name) {
    if (!name || name[0] == '\0') return true;
    if (_stricmp(name, "localhost") == 0) return true;
    if (strcmp(name, "127.0.0.1") == 0) return true;
    if (strcmp(name, "::1") == 0) return true;

    int dots = 0;
    bool all_digits_dots = true;
    for (int i = 0; name[i] != '\0'; i++) {
        if (name[i] == '.') dots++;
        else if (name[i] < '0' || name[i] > '9') {
            all_digits_dots = false;
            break;
        }
    }
    if (all_digits_dots && dots == 3) return true;
    if (strchr(name, ':') != nullptr) return true;

    return false;
}

// Direct DNS APIs can delegate to the shared Windows DNS service. They cannot
// represent remote CONNECT resolution, so protected queries must fail explicitly.
DNS_STATUS WINAPI HookDnsQueryA(PCSTR name, WORD type, DWORD options, PVOID extra, PDNS_RECORDA* result, PVOID* reserved) {
    if (!IsHookEnabled() || !g_config.policy.remote_dns_required || IsLocalOrIp(name)) return TrueDnsQueryA(name,type,options,extra,result,reserved);
    if (result) *result = nullptr;
    return ERROR_NOT_SUPPORTED;
}
DNS_STATUS WINAPI HookDnsQueryUtf8(PCSTR name, WORD type, DWORD options, PVOID extra, PDNS_RECORDA* result, PVOID* reserved) {
    if (!IsHookEnabled() || !g_config.policy.remote_dns_required || IsLocalOrIp(name)) return TrueDnsQueryUtf8(name,type,options,extra,result,reserved);
    if (result) *result = nullptr;
    return ERROR_NOT_SUPPORTED;
}
static bool ProtectedWideName(PCWSTR name) {
    if (!name) return false;
    char narrow[256] = {};
    return !WideCharToMultiByte(CP_UTF8, 0, name, -1, narrow, sizeof(narrow), nullptr, nullptr) || !IsLocalOrIp(narrow);
}
DNS_STATUS WINAPI HookDnsQueryW(PCWSTR name, WORD type, DWORD options, PVOID extra, PDNS_RECORD* result, PVOID* reserved) {
    if (!IsHookEnabled() || !g_config.policy.remote_dns_required || !ProtectedWideName(name)) return TrueDnsQueryW(name,type,options,extra,result,reserved);
    if (result) *result = nullptr;
    return ERROR_NOT_SUPPORTED;
}
DNS_STATUS WINAPI HookDnsQueryEx(PDNS_QUERY_REQUEST request, PDNS_QUERY_RESULT result, PDNS_QUERY_CANCEL cancel) {
    if (!IsHookEnabled() || !g_config.policy.remote_dns_required || !request || !ProtectedWideName(request->QueryName)) return TrueDnsQueryEx(request,result,cancel);
    if (result) { result->QueryStatus = ERROR_NOT_SUPPORTED; result->pQueryRecords = nullptr; }
    return ERROR_NOT_SUPPORTED;
}

hostent* WSAAPI HookGetHostByName(const char* name) {
    if (!IsHookEnabled() || !g_config.policy.remote_dns_required || IsLocalOrIp(name)) return TrueGetHostByName(name);
    if (strlen(name) > 253) { WSASetLastError(WSAHOST_NOT_FOUND); return nullptr; }
    thread_local std::string hostname;
    thread_local uint32_t address;
    thread_local char* addresses[2];
    thread_local char* aliases[1] = { nullptr };
    thread_local hostent result;
    address = AllocateFakeIpForDomain(name);
    if (!address) { WSASetLastError(WSA_NOT_ENOUGH_MEMORY); return nullptr; }
    hostname = name;
    addresses[0] = reinterpret_cast<char*>(&address); addresses[1] = nullptr;
    result.h_name = &hostname[0]; result.h_aliases = aliases;
    result.h_addrtype = AF_INET; result.h_length = 4; result.h_addr_list = addresses;
    return &result;
}

static std::unordered_set<void*> g_custom_ex_set;
static std::mutex g_custom_ex_mutex;

template<class Ex> static void FreeExtended(Ex* node) {
    while (node) { Ex* next = node->ai_next; free(node->ai_addr); free(node); node = next; }
}

template<class Ex, class Base> static int ExtendAddress(Base* source, Ex** result) {
    Ex* head = nullptr; Ex** tail = &head;
    for (auto* current = source; current; current = current->ai_next) {
        Ex* node = static_cast<Ex*>(calloc(1, sizeof(Ex)));
        if (!node) { FreeExtended(head); return EAI_MEMORY; }
        node->ai_addr = static_cast<sockaddr*>(malloc(current->ai_addrlen));
        if (!node->ai_addr) { free(node); FreeExtended(head); return EAI_MEMORY; }
        memcpy(node->ai_addr, current->ai_addr, current->ai_addrlen);
        node->ai_family = current->ai_family; node->ai_socktype = current->ai_socktype;
        node->ai_protocol = current->ai_protocol; node->ai_addrlen = current->ai_addrlen;
        *tail = node; tail = &node->ai_next;
    }
    { std::lock_guard<std::mutex> lock(g_custom_ex_mutex); g_custom_ex_set.insert(head); }
    *result = head; return 0;
}

int WSAAPI HookGetAddrInfoExA(PCSTR name, PCSTR service, DWORD space, LPGUID provider,
    const ADDRINFOEXA* hints, PADDRINFOEXA* result, timeval* timeout, LPOVERLAPPED overlap,
    LPLOOKUPSERVICE_COMPLETION_ROUTINE completion, LPHANDLE handle) {
    if (!IsHookEnabled() || !g_config.policy.remote_dns_required || IsLocalOrIp(name))
        return TrueGetAddrInfoExA(name, service, space, provider, hints, result, timeout, overlap, completion, handle);
    if (!result) return WSAEFAULT;
    *result = nullptr;
    // Asynchronous providers have separate completion/cancellation contracts.
    // Refuse unsupported queries explicitly instead of releasing them to DNS.
    if (overlap || completion || provider || (space != NS_ALL && space != NS_DNS)) return WSAEOPNOTSUPP;
    if (handle) *handle = nullptr;
    ADDRINFOA basic = {};
    if (hints) { basic.ai_flags = hints->ai_flags; basic.ai_family = hints->ai_family; basic.ai_socktype = hints->ai_socktype; basic.ai_protocol = hints->ai_protocol; }
    PADDRINFOA answer = nullptr;
    int error = HookGetAddrInfo(name, service, &basic, &answer);
    if (!error) error = ExtendAddress(answer, result);
    HookFreeAddrInfo(answer); return error;
}

int WSAAPI HookGetAddrInfoExW(PCWSTR name, PCWSTR service, DWORD space, LPGUID provider,
    const ADDRINFOEXW* hints, PADDRINFOEXW* result, timeval* timeout, LPOVERLAPPED overlap,
    LPLOOKUPSERVICE_COMPLETION_ROUTINE completion, LPHANDLE handle) {
    char narrow[256] = {};
    if (!IsHookEnabled() || !g_config.policy.remote_dns_required || !name)
        return TrueGetAddrInfoExW(name, service, space, provider, hints, result, timeout, overlap, completion, handle);
    if (!WideCharToMultiByte(CP_UTF8, 0, name, -1, narrow, sizeof(narrow), nullptr, nullptr)) return EAI_NONAME;
    if (IsLocalOrIp(narrow)) return TrueGetAddrInfoExW(name, service, space, provider, hints, result, timeout, overlap, completion, handle);
    if (!result) return WSAEFAULT;
    *result = nullptr;
    if (overlap || completion || provider || (space != NS_ALL && space != NS_DNS)) return WSAEOPNOTSUPP;
    if (handle) *handle = nullptr;
    ADDRINFOW basic = {};
    if (hints) { basic.ai_flags = hints->ai_flags; basic.ai_family = hints->ai_family; basic.ai_socktype = hints->ai_socktype; basic.ai_protocol = hints->ai_protocol; }
    PADDRINFOW answer = nullptr;
    int error = HookGetAddrInfoW(name, service, &basic, &answer);
    if (!error) error = ExtendAddress(answer, result);
    HookFreeAddrInfoW(answer); return error;
}

void WSAAPI HookFreeAddrInfoExA(PADDRINFOEXA result) {
    bool owned;
    { std::lock_guard<std::mutex> lock(g_custom_ex_mutex); owned = g_custom_ex_set.erase(result) != 0; }
    if (owned) FreeExtended(result); else TrueFreeAddrInfoExA(result);
}
void WSAAPI HookFreeAddrInfoExW(PADDRINFOEXW result) {
    bool owned;
    { std::lock_guard<std::mutex> lock(g_custom_ex_mutex); owned = g_custom_ex_set.erase(result) != 0; }
    if (owned) FreeExtended(result); else TrueFreeAddrInfoExW(result);
}

// 辅助跳过 DNS 报文中的压缩名称
static size_t SkipDnsName(const uint8_t* buf, size_t pos, size_t total) {
    while (pos < total) {
        uint8_t len = buf[pos];
        if (len == 0) return pos + 1;
        if ((len & 0xC0) == 0xC0) {
            // 指针占 2 字节
            return pos + 2;
        }
        pos += 1 + len;
    }
    return total;
}

// 本地安全 DNS 服务可用性探测与极速熔断器 (防止未开启 DNS 监听时多域名死等假死)
static std::atomic<bool> g_dns_circuit_open(false);
static std::atomic<DWORD> g_dns_circuit_open_tick(0);
static std::atomic<int> g_dns_consecutive_fails(0);

// 向 127.0.0.1:dns_port 发送 UDP DNS 查询，获取真实 IPv4 列表
static std::vector<uint32_t> QueryDnsA(const char* domain, uint16_t dns_port) {
    std::vector<uint32_t> results;
    if (!domain || strlen(domain) == 0 || strlen(domain) > 253 || dns_port == 0) return results;

    // 检查熔断状态：若处于熔断期 (10 秒内)，直接跳过本地查询，0ms 秒级回退原生解析
    if (g_dns_circuit_open.load()) {
        if (GetTickCount() - g_dns_circuit_open_tick.load() < 10000) {
            return results;
        } else {
            g_dns_circuit_open.store(false); // 10秒后解除熔断尝试恢复
        }
    }

    SOCKET s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == INVALID_SOCKET) return results;

    DWORD timeout_ms = 350; // 本地 127.0.0.1 查询 350ms 足矣，超常则判定未监听
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout_ms, sizeof(timeout_ms));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&timeout_ms, sizeof(timeout_ms));

    sockaddr_in dns_server;
    memset(&dns_server, 0, sizeof(dns_server));
    dns_server.sin_family = AF_INET;
    dns_server.sin_port = htons(dns_port);
    dns_server.sin_addr.s_addr = htonl(INADDR_LOOPBACK); // 127.0.0.1

    // 构造请求
    std::vector<uint8_t> packet;
    uint16_t tx_id = (uint16_t)(rand() & 0xFFFF);
    packet.push_back((uint8_t)(tx_id >> 8));
    packet.push_back((uint8_t)(tx_id & 0xFF));
    packet.push_back(0x01); // Flags: RD=1
    packet.push_back(0x00);
    packet.push_back(0x00); packet.push_back(0x01); // QDCOUNT = 1
    packet.push_back(0x00); packet.push_back(0x00); // ANCOUNT = 0
    packet.push_back(0x00); packet.push_back(0x00); // NSCOUNT = 0
    packet.push_back(0x00); packet.push_back(0x00); // ARCOUNT = 0

    // QNAME
    const char* start = domain;
    while (*start != '\0') {
        const char* dot = strchr(start, '.');
        size_t len = dot ? (dot - start) : strlen(start);
        if (len == 0 || len > 63) {
            closesocket(s);
            return results;
        }
        packet.push_back((uint8_t)len);
        for (size_t i = 0; i < len; i++) {
            packet.push_back((uint8_t)start[i]);
        }
        if (!dot) break;
        start = dot + 1;
    }
    packet.push_back(0x00);

    // QTYPE = 1 (A), QCLASS = 1 (IN)
    packet.push_back(0x00); packet.push_back(0x01);
    packet.push_back(0x00); packet.push_back(0x01);

    int sent = sendto(s, (const char*)packet.data(), (int)packet.size(), 0, (sockaddr*)&dns_server, sizeof(dns_server));
    if (sent != (int)packet.size()) {
        closesocket(s);
        int fails = ++g_dns_consecutive_fails;
        if (fails >= 2) {
            g_dns_circuit_open.store(true);
            g_dns_circuit_open_tick.store(GetTickCount());
        }
        return results;
    }

    uint8_t recv_buf[1024];
    int recv_len = recv(s, (char*)recv_buf, sizeof(recv_buf), 0);
    closesocket(s);

    if (recv_len < 12) {
        int fails = ++g_dns_consecutive_fails;
        if (fails >= 2) {
            g_dns_circuit_open.store(true);
            g_dns_circuit_open_tick.store(GetTickCount());
        }
        return results;
    }
    g_dns_consecutive_fails.store(0);

    // 校验事务 ID
    uint16_t resp_id = (recv_buf[0] << 8) | recv_buf[1];
    if (resp_id != tx_id) return results;

    uint8_t rcode = recv_buf[3] & 0x0F;
    if (rcode != 0) return results; // 错误响应

    uint16_t qd_count = (recv_buf[4] << 8) | recv_buf[5];
    uint16_t an_count = (recv_buf[6] << 8) | recv_buf[7];
    if (an_count == 0) return results;

    size_t pos = 12;
    // 跳过 Queries
    for (uint16_t i = 0; i < qd_count; i++) {
        pos = SkipDnsName(recv_buf, pos, (size_t)recv_len);
        pos += 4; // QTYPE (2) + QCLASS (2)
        if (pos > (size_t)recv_len) return results;
    }

    // 解析 Answers
    for (uint16_t i = 0; i < an_count; i++) {
        if (pos >= (size_t)recv_len) break;
        pos = SkipDnsName(recv_buf, pos, (size_t)recv_len);
        if (pos + 10 > (size_t)recv_len) break;

        uint16_t type = (recv_buf[pos] << 8) | recv_buf[pos + 1];
        uint16_t cls  = (recv_buf[pos + 2] << 8) | recv_buf[pos + 3];
        // ttl: pos + 4 .. pos + 7
        uint16_t rdlen = (recv_buf[pos + 8] << 8) | recv_buf[pos + 9];
        pos += 10;

        if (pos + rdlen > (size_t)recv_len) break;

        if (type == 1 && cls == 1 && rdlen == 4) {
            // IPv4 A 记录
            uint32_t ip = *(uint32_t*)&recv_buf[pos];
            results.push_back(ip); // 网络字节序
        }
        pos += rdlen;
    }

    return results;
}

static uint16_t ParsePort(const char* serv) {
    if (!serv || serv[0] == '\0') return 0;
    if (_stricmp(serv, "http") == 0) return htons(80);
    if (_stricmp(serv, "https") == 0) return htons(443);
    int p = atoi(serv);
    if (p > 0 && p <= 65535) return htons((uint16_t)p);
    return 0;
}

int WSAAPI HookGetAddrInfo(
    PCSTR pNodeName,
    PCSTR pServiceName,
    const ADDRINFOA *pHints,
    PADDRINFOA *ppResult
) {
    if (!IsHookEnabled() || !ppResult) {
        return TrueGetAddrInfo(pNodeName, pServiceName, pHints, ppResult);
    }

    // 阻止 IPv6：如果调用方仅请求 IPv6 (AAAA)，直接返回无记录，杜绝绕过代理
    if (g_config.policy.block_ipv6 && pHints && pHints->ai_family == AF_INET6) {
        return EAI_NONAME;
    }

    if (IsLocalOrIp(pNodeName)) {
        return TrueGetAddrInfo(pNodeName, pServiceName, pHints, ppResult);
    }
    if (g_config.policy.remote_dns_required && strlen(pNodeName) > 253) return EAI_NONAME;
    if (g_config.policy.remote_dns_required && pHints && (pHints->ai_flags & AI_NUMERICHOST)) return EAI_NONAME;

    // 系统原生解析模式：直接放行调用系统原生解析，TCP 仍受 Hook 代理
    if (g_config.policy.dns_mode == DnsMode::SystemNative) {
        return TrueGetAddrInfo(pNodeName, pServiceName, pHints, ppResult);
    }

    std::vector<uint32_t> ips;
    if (g_config.policy.dns_mode == DnsMode::FakeIp) {
        // Fake-IP 极速模式：0ms 分配 198.18.x.x 假 IP，后续 SOCKS5 发送原始域名
        uint32_t fake_ip = AllocateFakeIpForDomain(pNodeName);
        if (!fake_ip) return EAI_MEMORY;
        ips.push_back(fake_ip);
    } else {
        // 安全纯净解析模式：向 127.0.0.1:dns_port 发送真实安全 DNS 查询
        ips = QueryDnsA(pNodeName, g_config.dns_port);
        if (ips.empty()) {
            return TrueGetAddrInfo(pNodeName, pServiceName, pHints, ppResult);
        }
    }

    uint16_t port = ParsePort(pServiceName);
    PADDRINFOA head = nullptr;
    PADDRINFOA tail = nullptr;

    for (uint32_t ip : ips) {
        PADDRINFOA node = (PADDRINFOA)calloc(1, sizeof(ADDRINFOA));
        sockaddr_in* sin = (sockaddr_in*)calloc(1, sizeof(sockaddr_in));
        if (!node || !sin) {
            if (node) free(node);
            if (sin) free(sin);
            continue;
        }

        sin->sin_family = AF_INET;
        sin->sin_port = port;
        sin->sin_addr.s_addr = ip;

        node->ai_family = AF_INET;
        node->ai_socktype = (pHints && pHints->ai_socktype != 0) ? pHints->ai_socktype : SOCK_STREAM;
        node->ai_protocol = (pHints && pHints->ai_protocol != 0) ? pHints->ai_protocol : IPPROTO_TCP;
        node->ai_addrlen = sizeof(sockaddr_in);
        node->ai_addr = (sockaddr*)sin;

        if (!head) {
            head = node;
            tail = node;
        } else {
            tail->ai_next = node;
            tail = node;
        }
    }

    if (!head) {
        if (g_config.policy.remote_dns_required) return EAI_MEMORY;
        return TrueGetAddrInfo(pNodeName, pServiceName, pHints, ppResult);
    }

    {
        std::lock_guard<std::mutex> lock(g_custom_ai_mutex);
        g_custom_ai_set.insert((void*)head);
    }

    *ppResult = head;
    return 0;
}

int WSAAPI HookGetAddrInfoW(
    PCWSTR pNodeName,
    PCWSTR pServiceName,
    const ADDRINFOW *pHints,
    PADDRINFOW *ppResult
) {
    if (!IsHookEnabled() || !ppResult) {
        return TrueGetAddrInfoW(pNodeName, pServiceName, pHints, ppResult);
    }

    // 阻止 IPv6：如果调用方仅请求 IPv6 (AAAA)，直接返回无记录，杜绝绕过代理
    if (g_config.policy.block_ipv6 && pHints && pHints->ai_family == AF_INET6) {
        return EAI_NONAME;
    }

    char node_a[256] = { 0 };
    if (pNodeName) {
        if (!WideCharToMultiByte(CP_UTF8, 0, pNodeName, -1, node_a, sizeof(node_a) - 1, nullptr, nullptr)
            && g_config.policy.remote_dns_required) return EAI_NONAME;
    }

    if (IsLocalOrIp(node_a)) {
        return TrueGetAddrInfoW(pNodeName, pServiceName, pHints, ppResult);
    }
    if (g_config.policy.remote_dns_required && pHints && (pHints->ai_flags & AI_NUMERICHOST)) return EAI_NONAME;

    // 系统原生解析模式：直接放行调用系统原生解析，TCP 仍受 Hook 代理
    if (g_config.policy.dns_mode == DnsMode::SystemNative) {
        return TrueGetAddrInfoW(pNodeName, pServiceName, pHints, ppResult);
    }

    std::vector<uint32_t> ips;
    if (g_config.policy.dns_mode == DnsMode::FakeIp) {
        // Fake-IP 极速模式：0ms 分配 198.18.x.x 假 IP，后续 SOCKS5 发送原始域名
        uint32_t fake_ip = AllocateFakeIpForDomain(node_a);
        if (!fake_ip) return EAI_MEMORY;
        ips.push_back(fake_ip);
    } else {
        // 安全纯净解析模式：向 127.0.0.1:dns_port 发送真实安全 DNS 查询
        ips = QueryDnsA(node_a, g_config.dns_port);
        if (ips.empty()) {
            return TrueGetAddrInfoW(pNodeName, pServiceName, pHints, ppResult);
        }
    }

    char serv_a[64] = { 0 };
    if (pServiceName) {
        WideCharToMultiByte(CP_UTF8, 0, pServiceName, -1, serv_a, sizeof(serv_a) - 1, nullptr, nullptr);
    }
    uint16_t port = ParsePort(serv_a);

    PADDRINFOW head = nullptr;
    PADDRINFOW tail = nullptr;

    for (uint32_t ip : ips) {
        PADDRINFOW node = (PADDRINFOW)calloc(1, sizeof(ADDRINFOW));
        sockaddr_in* sin = (sockaddr_in*)calloc(1, sizeof(sockaddr_in));
        if (!node || !sin) {
            if (node) free(node);
            if (sin) free(sin);
            continue;
        }

        sin->sin_family = AF_INET;
        sin->sin_port = port;
        sin->sin_addr.s_addr = ip;

        node->ai_family = AF_INET;
        node->ai_socktype = (pHints && pHints->ai_socktype != 0) ? pHints->ai_socktype : SOCK_STREAM;
        node->ai_protocol = (pHints && pHints->ai_protocol != 0) ? pHints->ai_protocol : IPPROTO_TCP;
        node->ai_addrlen = sizeof(sockaddr_in);
        node->ai_addr = (sockaddr*)sin;

        if (!head) {
            head = node;
            tail = node;
        } else {
            tail->ai_next = node;
            tail = node;
        }
    }

    if (!head) {
        if (g_config.policy.remote_dns_required) return EAI_MEMORY;
        return TrueGetAddrInfoW(pNodeName, pServiceName, pHints, ppResult);
    }

    {
        std::lock_guard<std::mutex> lock(g_custom_ai_mutex);
        g_custom_ai_set.insert((void*)head);
    }

    *ppResult = head;
    return 0;
}

void WSAAPI HookFreeAddrInfo(PADDRINFOA pAddrInfo) {
    if (!pAddrInfo) return;

    bool is_custom = false;
    {
        std::lock_guard<std::mutex> lock(g_custom_ai_mutex);
        auto it = g_custom_ai_set.find((void*)pAddrInfo);
        if (it != g_custom_ai_set.end()) {
            is_custom = true;
            g_custom_ai_set.erase(it);
        }
    }

    if (is_custom) {
        PADDRINFOA curr = pAddrInfo;
        while (curr) {
            PADDRINFOA next = curr->ai_next;
            if (curr->ai_addr) free(curr->ai_addr);
            if (curr->ai_canonname) free(curr->ai_canonname);
            free(curr);
            curr = next;
        }
    } else {
        TrueFreeAddrInfo(pAddrInfo);
    }
}

void WSAAPI HookFreeAddrInfoW(PADDRINFOW pAddrInfo) {
    if (!pAddrInfo) return;

    bool is_custom = false;
    {
        std::lock_guard<std::mutex> lock(g_custom_ai_mutex);
        auto it = g_custom_ai_set.find((void*)pAddrInfo);
        if (it != g_custom_ai_set.end()) {
            is_custom = true;
            g_custom_ai_set.erase(it);
        }
    }

    if (is_custom) {
        PADDRINFOW curr = pAddrInfo;
        while (curr) {
            PADDRINFOW next = curr->ai_next;
            if (curr->ai_addr) free(curr->ai_addr);
            if (curr->ai_canonname) free(curr->ai_canonname);
            free(curr);
            curr = next;
        }
    } else {
        TrueFreeAddrInfoW(pAddrInfo);
    }
}
