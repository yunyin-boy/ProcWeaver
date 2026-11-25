#define _CRT_SECURE_NO_WARNINGS
#include "pw_common.h"
#include "dns_hook.h"
#include "socket_hook.h"
#include "process_hook.h"
#include <cwchar>

HookConfig g_config = {
    0, 45053, false, false,
    { true, true, true, false, true, true, DnsMode::SafePure, PortFilterMode::All, {}, TargetFilterMode::All, {}, false },
    {}, ""
};
HMODULE g_hModule = NULL;
thread_local uint32_t g_reentry_depth = 0;
HookTier g_hook_tier = HookTier::Unknown;

static bool ReadEnvBool(const char* name, bool default_val) {
    char buf[16] = { 0 };
    DWORD r = GetEnvironmentVariableA(name, buf, sizeof(buf));
    if (r > 0 && r < sizeof(buf)) {
        if (strcmp(buf, "0") == 0 || _stricmp(buf, "false") == 0) return false;
        if (strcmp(buf, "1") == 0 || _stricmp(buf, "true") == 0) return true;
    }
    return default_val;
}

static HANDLE g_control_event = NULL;
static HANDLE g_control_host = NULL;
static bool g_control_required = false;
static bool g_policy_resolved = false;
static bool g_hooks_installed = false;

static bool ControlIsLive() {
    return g_control_event && g_control_host &&
        WaitForSingleObject(g_control_event, 0) == WAIT_TIMEOUT &&
        WaitForSingleObject(g_control_host, 0) == WAIT_TIMEOUT;
}

bool IsHookEnabled() {
    if (!g_config.enabled) return false;
    if (g_config.reject_all) return ControlIsLive();
    if (!g_control_required) return true;
    // An unreadable control channel is not permission to bypass a binding.
    // Only a confirmed revocation or confirmed host exit switches to native IO.
    if (g_control_event && WaitForSingleObject(g_control_event, 0) == WAIT_OBJECT_0) return false;
    if (g_control_host && WaitForSingleObject(g_control_host, 0) == WAIT_OBJECT_0) return false;
    return true;
}

static std::string ToLowerAscii(const std::string& input) {
    std::string out = input;
    for (auto& c : out) c = (char)tolower((unsigned char)c);
    return out;
}

static std::string ReadEnvDynamic(const char* name) {
    DWORD needed = GetEnvironmentVariableA(name, nullptr, 0);
    if (needed == 0) return {};
    std::string buf(needed, '\0');
    DWORD written = GetEnvironmentVariableA(name, &buf[0], needed);
    if (written == 0 || written >= needed) return {};
    buf.resize(written);
    return buf;
}

static std::string LookupByKey(const std::string& lower_rules, const std::string& key) {
    if (key.empty() || lower_rules.empty()) return {};
    std::string pattern = key + "=";
    size_t pos = 0;
    while ((pos = lower_rules.find(pattern, pos)) != std::string::npos) {
        if (pos == 0 || lower_rules[pos - 1] == ';') {
            size_t val_start = pos + pattern.length();
            size_t val_end = lower_rules.find(';', val_start);
            if (val_end == std::string::npos) val_end = lower_rules.length();
            return lower_rules.substr(val_start, val_end - val_start);
        }
        pos += 1;
    }
    return {};
}

std::string LookupOverrideRuleAction(const std::string& rules, const std::string& full_path, const std::string& exe_name) {
    if (rules.empty()) return {};
    std::string lower_rules = ToLowerAscii(rules);
    std::string lower_path = ToLowerAscii(full_path);
    std::string lower_name = ToLowerAscii(exe_name);

    if (!lower_path.empty()) {
        std::string v = LookupByKey(lower_rules, "path:" + lower_path);
        if (!v.empty()) return v;
    }
    if (!lower_name.empty()) {
        std::string v = LookupByKey(lower_rules, "name:" + lower_name);
        if (!v.empty()) return v;
        // 兼容未加前缀的旧式规则项
        v = LookupByKey(lower_rules, lower_name);
        if (!v.empty()) return v;
    }
    return {};
}

void LoadHookConfig() {
    g_policy_resolved = ReadEnvBool("PROCWEAVER_POLICY_RESOLVED", false);
    wchar_t control[256] = {0};
    DWORD control_length = GetEnvironmentVariableW(L"PROCWEAVER_HOOK_CONTROL", control, _countof(control));
    if (control_length > 0 && control_length < _countof(control)) {
        g_control_required = true;
        g_control_event = OpenEventW(SYNCHRONIZE, FALSE, control);
        char host[32] = {0};
        if (GetEnvironmentVariableA("PROCWEAVER_HOOK_HOST_PID", host, sizeof(host)) > 0) {
            g_control_host = OpenProcess(SYNCHRONIZE, FALSE, strtoul(host, NULL, 10));
        }
    }
    char bundle_buf[32] = { 0 };
    DWORD r1 = GetEnvironmentVariableA("PROCWEAVER_BUNDLE_PORT", bundle_buf, sizeof(bundle_buf));
    if (r1 > 0 && r1 < sizeof(bundle_buf)) {
        int port = atoi(bundle_buf);
        if (port > 0 && port <= 65535) {
            g_config.bundle_port = (uint16_t)port;
        }
    }

    g_config.override_rules = ReadEnvDynamic("PROCWEAVER_OVERRIDE_RULES");

    char action_buf[32] = { 0 };
    if (GetEnvironmentVariableA("PROCWEAVER_ACTION", action_buf, sizeof(action_buf)) > 0) {
        if (_stricmp(action_buf, "REJECT") == 0) {
            g_config.reject_all = true;
            g_config.bundle_port = 0;
        } else if (_stricmp(action_buf, "DIRECT") == 0) {
            g_config.bundle_port = 0;
            g_config.reject_all = false;
        }
    }

    // 针对自身进程完整路径与文件名核验专有覆盖规则（path 优先于 name，边界严格对齐）
    char selfPath[MAX_PATH] = { 0 };
    // The explicit REJECT decision must survive the root and child handoffs.
    if (!g_policy_resolved && !g_config.reject_all &&
        GetModuleFileNameA(NULL, selfPath, MAX_PATH) > 0 && !g_config.override_rules.empty()) {
        const char* base = strrchr(selfPath, '\\');
        const char* myName = base ? (base + 1) : selfPath;
        std::string matched = LookupOverrideRuleAction(g_config.override_rules, selfPath, myName);
        if (matched == "direct") {
            g_config.bundle_port = 0;
            g_config.reject_all = false;
        } else if (matched == "reject") {
            g_config.bundle_port = 0;
            g_config.reject_all = true;
        } else if (!matched.empty()) {
            int p = atoi(matched.c_str());
            if (p > 0 && p <= 65535) {
                g_config.bundle_port = (uint16_t)p;
                g_config.reject_all = false;
            }
        }
    }

    g_config.enabled = (g_config.bundle_port > 0 || g_config.reject_all);

    char dns_buf[32] = { 0 };
    DWORD r2 = GetEnvironmentVariableA("PROCWEAVER_DNS_PORT", dns_buf, sizeof(dns_buf));
    if (r2 > 0 && r2 < sizeof(dns_buf)) {
        int dport = atoi(dns_buf);
        if (dport > 0 && dport <= 65535) {
            g_config.dns_port = (uint16_t)dport;
        }
    }

    char sysproxy_buf[256] = { 0 };
    DWORD r_sp = GetEnvironmentVariableA("PROCWEAVER_SYSTEM_PROXY_PORTS", sysproxy_buf, sizeof(sysproxy_buf));
    if (r_sp > 0 && r_sp < sizeof(sysproxy_buf)) {
        char* token = strtok(sysproxy_buf, ",; ");
        while (token) {
            int p = atoi(token);
            if (p > 0 && p <= 65535) {
                g_config.system_proxy_ports.insert((uint16_t)p);
            }
            token = strtok(nullptr, ",; ");
        }
    }
    // 默认垫底端口保障
    g_config.system_proxy_ports.insert(7890);
    g_config.system_proxy_ports.insert(10809);
    g_config.system_proxy_ports.insert(10811);
    g_config.system_proxy_ports.insert(7897);

    // 读取精细化策略配置
    g_config.policy.proxy_tcp = ReadEnvBool("PROCWEAVER_PROXY_TCP", true);
    g_config.policy.block_ipv6 = ReadEnvBool("PROCWEAVER_BLOCK_IPV6", true);
    g_config.policy.block_udp = ReadEnvBool("PROCWEAVER_BLOCK_UDP", true);
    g_config.policy.proxy_udp = ReadEnvBool("PROCWEAVER_PROXY_UDP", false);
    g_config.policy.proxy_subprocesses = ReadEnvBool("PROCWEAVER_PROXY_SUBPROCESSES", true);
    g_config.policy.bypass_lan = ReadEnvBool("PROCWEAVER_BYPASS_LAN", true);
    g_config.policy.remote_dns_required = ReadEnvBool("PROCWEAVER_REMOTE_DNS_REQUIRED", false);
    g_config.policy.scoped_dns = ReadEnvBool("PROCWEAVER_SCOPED_DNS", false);
    g_config.policy.core_listener = ReadEnvBool("PROCWEAVER_CORE_LISTENER", false);

    char dns_mode_buf[32] = { 0 };
    if (GetEnvironmentVariableA("PROCWEAVER_DNS_MODE", dns_mode_buf, sizeof(dns_mode_buf)) > 0) {
        if (_stricmp(dns_mode_buf, "fake_ip") == 0) {
            g_config.policy.dns_mode = DnsMode::FakeIp;
        } else if (_stricmp(dns_mode_buf, "system_native") == 0) {
            g_config.policy.dns_mode = DnsMode::SystemNative;
        } else {
            g_config.policy.dns_mode = DnsMode::SafePure;
        }
    }

    char port_filter_buf[32] = { 0 };
    if (g_config.policy.remote_dns_required && !g_config.policy.scoped_dns) {
        g_config.policy.dns_mode = DnsMode::FakeIp;
    }
    if (g_config.policy.dns_mode == DnsMode::SystemNative) {
        char servers[12288] = {};
        DWORD length = GetEnvironmentVariableA("PROCWEAVER_NATIVE_DNS_SERVERS", servers, sizeof(servers));
        if (length && length < sizeof(servers)) {
            const std::string list(servers, length);
            for (size_t start = 0; start < list.size();) {
                size_t end = list.find(',', start);
                g_config.policy.native_dns_servers.push_back(list.substr(start, end - start));
                if (end == std::string::npos) break;
                start = end + 1;
            }
        }
    }
    if (GetEnvironmentVariableA("PROCWEAVER_PORT_FILTER_MODE", port_filter_buf, sizeof(port_filter_buf)) > 0) {
        if (_stricmp(port_filter_buf, "web_only") == 0) {
            g_config.policy.port_filter_mode = PortFilterMode::WebOnly;
        } else if (_stricmp(port_filter_buf, "custom") == 0) {
            g_config.policy.port_filter_mode = PortFilterMode::Custom;
        } else {
            g_config.policy.port_filter_mode = PortFilterMode::All;
        }
    }

    char custom_ports_buf[512] = { 0 };
    if (GetEnvironmentVariableA("PROCWEAVER_CUSTOM_PORTS", custom_ports_buf, sizeof(custom_ports_buf)) > 0) {
        g_config.policy.custom_ports.clear();
        char* token = strtok(custom_ports_buf, ",; ");
        while (token) {
            int p = atoi(token);
            if (p > 0 && p <= 65535) {
                g_config.policy.custom_ports.insert((uint16_t)p);
            }
            token = strtok(nullptr, ",; ");
        }
    }

    char target_mode_buf[32] = { 0 };
    if (GetEnvironmentVariableA("PROCWEAVER_TARGET_FILTER_MODE", target_mode_buf, sizeof(target_mode_buf)) > 0) {
        if (_stricmp(target_mode_buf, "include") == 0) {
            g_config.policy.target_filter_mode = TargetFilterMode::Include;
        } else if (_stricmp(target_mode_buf, "exclude") == 0) {
            g_config.policy.target_filter_mode = TargetFilterMode::Exclude;
        } else {
            g_config.policy.target_filter_mode = TargetFilterMode::All;
        }
    }

    char target_rules_buf[4096] = { 0 };
    if (GetEnvironmentVariableA("PROCWEAVER_TARGET_RULES", target_rules_buf, sizeof(target_rules_buf)) > 0) {
        g_config.policy.target_rules.clear();
        char* token = strtok(target_rules_buf, ",; \r\n");
        while (token) {
            if (token[0] != '\0') {
                g_config.policy.target_rules.push_back(token);
            }
            token = strtok(nullptr, ",; \r\n");
        }
    }
}

std::string GetCurrentDllDir() {
    char path[MAX_PATH] = { 0 };
    GetModuleFileNameA(g_hModule, path, MAX_PATH);
    char* last_slash = strrchr(path, '\\');
    if (last_slash) {
        *last_slash = '\0';
    }
    return std::string(path);
}


static bool IsAcgEnabled() {
    typedef BOOL (WINAPI *LPFN_GETPROCESSMITIGATIONPOLICY)(
        HANDLE hProcess,
        int MitigationPolicy,
        PVOID lpBuffer,
        SIZE_T dwLength
    );
    static LPFN_GETPROCESSMITIGATIONPOLICY fnGetPolicy = (LPFN_GETPROCESSMITIGATIONPOLICY)GetProcAddress(
        GetModuleHandleA("kernel32.dll"), "GetProcessMitigationPolicy"
    );
    if (!fnGetPolicy) return false;

    // ProcessDynamicCodePolicy = 2
    struct {
        DWORD ProhibitDynamicCode : 1;
        DWORD AllowThreadOptOut : 1;
        DWORD AllowRemoteDowngrade : 1;
        DWORD AuditProhibitDynamicCode : 1;
        DWORD ReservedFlags : 28;
    } policy;
    ZeroMemory(&policy, sizeof(policy));

    if (fnGetPolicy(GetCurrentProcess(), 2, &policy, sizeof(policy))) {
        if (policy.ProhibitDynamicCode) {
            return true;
        }
    }
    return false;
}

static bool HookIatEntry(HMODULE hMod, const char* targetDll, const char* funcName, void* newFunc, void** oldFunc) {
    if (!hMod || !targetDll || !funcName || !newFunc) return false;

    PIMAGE_DOS_HEADER dosHeader = (PIMAGE_DOS_HEADER)hMod;
    if (dosHeader->e_magic != IMAGE_DOS_SIGNATURE) return false;

    PIMAGE_NT_HEADERS ntHeaders = (PIMAGE_NT_HEADERS)((BYTE*)hMod + dosHeader->e_lfanew);
    if (ntHeaders->Signature != IMAGE_NT_SIGNATURE) return false;

    DWORD importRva = ntHeaders->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress;
    if (importRva == 0) return false;

    PIMAGE_IMPORT_DESCRIPTOR importDesc = (PIMAGE_IMPORT_DESCRIPTOR)((BYTE*)hMod + importRva);

    while (importDesc->Name) {
        char* dllName = (char*)((BYTE*)hMod + importDesc->Name);
        if (_stricmp(dllName, targetDll) == 0) {
            PIMAGE_THUNK_DATA thunk = (PIMAGE_THUNK_DATA)((BYTE*)hMod + importDesc->FirstThunk);
            PIMAGE_THUNK_DATA origThunk = importDesc->OriginalFirstThunk ?
                (PIMAGE_THUNK_DATA)((BYTE*)hMod + importDesc->OriginalFirstThunk) : thunk;

            while (origThunk->u1.AddressOfData) {
                if (!(origThunk->u1.Ordinal & IMAGE_ORDINAL_FLAG)) {
                    PIMAGE_IMPORT_BY_NAME importByName = (PIMAGE_IMPORT_BY_NAME)((BYTE*)hMod + origThunk->u1.AddressOfData);
                    if (strcmp((char*)importByName->Name, funcName) == 0) {
                        DWORD oldProtect = 0;
                        if (VirtualProtect(&thunk->u1.Function, sizeof(void*), PAGE_READWRITE, &oldProtect)) {
                            if (oldFunc && *oldFunc == nullptr) {
                                *oldFunc = (void*)thunk->u1.Function;
                            }
                            thunk->u1.Function = (ULONG_PTR)newFunc;
                            VirtualProtect(&thunk->u1.Function, sizeof(void*), oldProtect, &oldProtect);
                            return true;
                        }
                    }
                }
                thunk++;
                origThunk++;
            }
        }
        importDesc++;
    }
    return false;
}

static bool InstallIatHooks(bool& connect_installed) {
    HMODULE hMain = GetModuleHandle(NULL);
    if (!hMain) return false;

    const bool connect = HookIatEntry(hMain, "ws2_32.dll", "connect", (void*)HookConnect, (void**)&TrueConnect);
    const bool wsa_connect = HookIatEntry(hMain, "ws2_32.dll", "WSAConnect", (void*)HookWSAConnect, (void**)&TrueWSAConnect);
    connect_installed = connect || wsa_connect;
    bool hooked_any = connect_installed;
    if (HookIatEntry(hMain, "ws2_32.dll", "sendto", (void*)HookSendTo, (void**)&TrueSendTo)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "WSASendTo", (void*)HookWSASendTo, (void**)&TrueWSASendTo)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "getaddrinfo", (void*)HookGetAddrInfo, (void**)&TrueGetAddrInfo)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "GetAddrInfoW", (void*)HookGetAddrInfoW, (void**)&TrueGetAddrInfoW)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "freeaddrinfo", (void*)HookFreeAddrInfo, (void**)&TrueFreeAddrInfo)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "FreeAddrInfoW", (void*)HookFreeAddrInfoW, (void**)&TrueFreeAddrInfoW)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "gethostbyname", (void*)HookGetHostByName, (void**)&TrueGetHostByName)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "GetAddrInfoExA", (void*)HookGetAddrInfoExA, (void**)&TrueGetAddrInfoExA)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "GetAddrInfoExW", (void*)HookGetAddrInfoExW, (void**)&TrueGetAddrInfoExW)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "FreeAddrInfoExA", (void*)HookFreeAddrInfoExA, (void**)&TrueFreeAddrInfoExA)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "FreeAddrInfoExW", (void*)HookFreeAddrInfoExW, (void**)&TrueFreeAddrInfoExW)) hooked_any = true;
    if (HookIatEntry(hMain, "dnsapi.dll", "DnsQuery_A", (void*)HookDnsQueryA, (void**)&TrueDnsQueryA)) hooked_any = true;
    if (HookIatEntry(hMain, "dnsapi.dll", "DnsQuery_W", (void*)HookDnsQueryW, (void**)&TrueDnsQueryW)) hooked_any = true;
    if (HookIatEntry(hMain, "dnsapi.dll", "DnsQuery_UTF8", (void*)HookDnsQueryUtf8, (void**)&TrueDnsQueryUtf8)) hooked_any = true;
    if (HookIatEntry(hMain, "dnsapi.dll", "DnsQueryEx", (void*)HookDnsQueryEx, (void**)&TrueDnsQueryEx)) hooked_any = true;

    if (HookIatEntry(hMain, "kernel32.dll", "CreateProcessW", (void*)HookCreateProcessW, (void**)&TrueCreateProcessW)) hooked_any = true;
    if (HookIatEntry(hMain, "kernel32.dll", "CreateProcessA", (void*)HookCreateProcessA, (void**)&TrueCreateProcessA)) hooked_any = true;

    return hooked_any;
}

static void WriteHookTierRecord(DWORD pid, HookTier tier, uint32_t bundle_port, const char* name) {
    HANDLE hMutex = CreateMutexA(NULL, FALSE, "Local\\ProcWeaver_Hook_Tiers_Mutex");
    if (hMutex) {
        WaitForSingleObject(hMutex, 500);
    }
    HANDLE hMap = CreateFileMappingA(
        INVALID_HANDLE_VALUE,
        NULL,
        PAGE_READWRITE,
        0,
        sizeof(HookStatusMap),
        "Local\\ProcWeaver_Hook_Tiers"
    );
    if (hMap) {
        HookStatusMap* map = (HookStatusMap*)MapViewOfFile(hMap, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(HookStatusMap));
        if (map) {
            if (map->magic != 0x5057484B) {
                map->magic = 0x5057484B; // "PWHK"
                map->count = 0;
            }
            int found_idx = -1;
            for (uint32_t i = 0; i < map->count && i < 256; i++) {
                if (map->records[i].pid == pid) {
                    found_idx = (int)i;
                    break;
                }
            }
            if (found_idx == -1 && map->count < 256) {
                found_idx = (int)map->count++;
            }
            if (found_idx >= 0 && found_idx < 256) {
                map->records[found_idx].pid = pid;
                map->records[found_idx].hook_tier = (uint32_t)tier;
                map->records[found_idx].bundle_port = bundle_port;
                map->records[found_idx].timestamp_ms = (uint64_t)GetTickCount();
                if (name && name[0]) {
                    strncpy(map->records[found_idx].process_name, name, sizeof(map->records[found_idx].process_name) - 1);
                    map->records[found_idx].process_name[sizeof(map->records[found_idx].process_name) - 1] = '\0';
                }
            }
            UnmapViewOfFile(map);
        }
        static HANDLE s_hMapKeepAlive = hMap;
        (void)s_hMapKeepAlive;
    }
    if (hMutex) {
        ReleaseMutex(hMutex);
        CloseHandle(hMutex);
    }
}

void ReportHookTier(HookTier tier) {
    g_hook_tier = tier;
    char fullPath[MAX_PATH] = { 0 };
    GetModuleFileNameA(NULL, fullPath, MAX_PATH);
    const char* baseName = strrchr(fullPath, '\\');
    const char* name = baseName ? (baseName + 1) : fullPath;
    WriteHookTierRecord(GetCurrentProcessId(), tier, g_config.bundle_port, name);
}

void ReportChildHookFailed(DWORD pid, const char* name) {
    WriteHookTierRecord(pid, HookTier::Failed, 0, name);
}

extern "C" __declspec(dllexport) DWORD WINAPI PwGetHookTier() {
    return (DWORD)g_hook_tier;
}

#ifdef _M_IX86
#pragma comment(linker, "/EXPORT:PwSuiteDnsVersion=_PwSuiteDnsVersion@0")
#endif
extern "C" __declspec(dllexport) DWORD WINAPI PwSuiteDnsVersion() { return 1; }

static bool InstallHooks() {
    DetourRestoreAfterWith();

    if (DetourTransactionBegin() != NO_ERROR) return false;
    if (DetourUpdateThread(GetCurrentThread()) != NO_ERROR) {
        DetourTransactionAbort();
        return false;
    }

    // 挂钩 DNS 解析 (路线 B)
    DetourAttach(&(PVOID&)TrueGetAddrInfo, (PVOID)HookGetAddrInfo);
    DetourAttach(&(PVOID&)TrueGetAddrInfoW, (PVOID)HookGetAddrInfoW);
    DetourAttach(&(PVOID&)TrueFreeAddrInfo, (PVOID)HookFreeAddrInfo);
    DetourAttach(&(PVOID&)TrueFreeAddrInfoW, (PVOID)HookFreeAddrInfoW);
    DetourAttach(&(PVOID&)TrueGetHostByName, (PVOID)HookGetHostByName);
    DetourAttach(&(PVOID&)TrueGetAddrInfoExA, (PVOID)HookGetAddrInfoExA);
    DetourAttach(&(PVOID&)TrueGetAddrInfoExW, (PVOID)HookGetAddrInfoExW);
    DetourAttach(&(PVOID&)TrueFreeAddrInfoExA, (PVOID)HookFreeAddrInfoExA);
    DetourAttach(&(PVOID&)TrueFreeAddrInfoExW, (PVOID)HookFreeAddrInfoExW);
    DetourAttach(&(PVOID&)TrueDnsQueryA, (PVOID)HookDnsQueryA);
    DetourAttach(&(PVOID&)TrueDnsQueryW, (PVOID)HookDnsQueryW);
    DetourAttach(&(PVOID&)TrueDnsQueryUtf8, (PVOID)HookDnsQueryUtf8);
    DetourAttach(&(PVOID&)TrueDnsQueryEx, (PVOID)HookDnsQueryEx);

    // 挂钩网络流量重定向与 QUIC 快速降级
    if (DetourAttach(&(PVOID&)TrueConnect, (PVOID)HookConnect) != NO_ERROR ||
        DetourAttach(&(PVOID&)TrueWSAConnect, (PVOID)HookWSAConnect) != NO_ERROR ||
        DetourAttach(&(PVOID&)TrueSendTo, (PVOID)HookSendTo) != NO_ERROR ||
        DetourAttach(&(PVOID&)TrueWSASendTo, (PVOID)HookWSASendTo) != NO_ERROR ||
        DetourAttach(&(PVOID&)TrueCreateProcessW, (PVOID)HookCreateProcessW) != NO_ERROR ||
        DetourAttach(&(PVOID&)TrueCreateProcessA, (PVOID)HookCreateProcessA) != NO_ERROR) {
        DetourTransactionAbort();
        return false;
    }
    // REJECT also guards IP socket creation. Winsock extension functions
    // operate on sockets and do not necessarily enter connect or sendto.
    if (g_config.reject_all &&
        (DetourAttach(&(PVOID&)TrueSocket, (PVOID)HookSocket) != NO_ERROR ||
         DetourAttach(&(PVOID&)TrueWSASocketA, (PVOID)HookWSASocketA) != NO_ERROR ||
         DetourAttach(&(PVOID&)TrueWSASocketW, (PVOID)HookWSASocketW) != NO_ERROR)) {
        DetourTransactionAbort();
        return false;
    }

    return DetourTransactionCommit() == NO_ERROR;
}

static void UninstallHooks() {
    DetourTransactionBegin();
    DetourUpdateThread(GetCurrentThread());

    DetourDetach(&(PVOID&)TrueGetAddrInfo, (PVOID)HookGetAddrInfo);
    DetourDetach(&(PVOID&)TrueGetAddrInfoW, (PVOID)HookGetAddrInfoW);
    DetourDetach(&(PVOID&)TrueFreeAddrInfo, (PVOID)HookFreeAddrInfo);
    DetourDetach(&(PVOID&)TrueFreeAddrInfoW, (PVOID)HookFreeAddrInfoW);
    DetourDetach(&(PVOID&)TrueGetHostByName, (PVOID)HookGetHostByName);
    DetourDetach(&(PVOID&)TrueGetAddrInfoExA, (PVOID)HookGetAddrInfoExA);
    DetourDetach(&(PVOID&)TrueGetAddrInfoExW, (PVOID)HookGetAddrInfoExW);
    DetourDetach(&(PVOID&)TrueFreeAddrInfoExA, (PVOID)HookFreeAddrInfoExA);
    DetourDetach(&(PVOID&)TrueFreeAddrInfoExW, (PVOID)HookFreeAddrInfoExW);
    DetourDetach(&(PVOID&)TrueDnsQueryA, (PVOID)HookDnsQueryA);
    DetourDetach(&(PVOID&)TrueDnsQueryW, (PVOID)HookDnsQueryW);
    DetourDetach(&(PVOID&)TrueDnsQueryUtf8, (PVOID)HookDnsQueryUtf8);
    DetourDetach(&(PVOID&)TrueDnsQueryEx, (PVOID)HookDnsQueryEx);

    DetourDetach(&(PVOID&)TrueConnect, (PVOID)HookConnect);
    DetourDetach(&(PVOID&)TrueWSAConnect, (PVOID)HookWSAConnect);
    DetourDetach(&(PVOID&)TrueSendTo, (PVOID)HookSendTo);
    DetourDetach(&(PVOID&)TrueWSASendTo, (PVOID)HookWSASendTo);
    if (g_config.reject_all) {
        DetourDetach(&(PVOID&)TrueSocket, (PVOID)HookSocket);
        DetourDetach(&(PVOID&)TrueWSASocketA, (PVOID)HookWSASocketA);
        DetourDetach(&(PVOID&)TrueWSASocketW, (PVOID)HookWSASocketW);
    }

    DetourDetach(&(PVOID&)TrueCreateProcessW, (PVOID)HookCreateProcessW);
    DetourDetach(&(PVOID&)TrueCreateProcessA, (PVOID)HookCreateProcessA);

    DetourTransactionCommit();
}


extern "C" __declspec(dllexport) BOOL WINAPI PwLaunchProcess(
    LPCWSTR lpApplicationName,
    LPWSTR lpCommandLine,
    LPCWSTR lpCurrentDirectory,
    LPCSTR lpDllPath,
    DWORD* lpPid
) {
    STARTUPINFOW si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));

    BOOL ok = DetourCreateProcessWithDllExW(
        lpApplicationName,
        lpCommandLine,
        NULL,
        NULL,
        FALSE,
        0,
        NULL,
        lpCurrentDirectory,
        &si,
        &pi,
        lpDllPath,
        NULL
    );

    if (ok) {
        if (lpPid) *lpPid = pi.dwProcessId;
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return TRUE;
    }
    return FALSE;
}

// The environment belongs to this launch, never to the ProcWeaver host.
extern "C" __declspec(dllexport) BOOL WINAPI PwLaunchProcessWithEnvironment(
    LPCWSTR application, LPWSTR command, LPCWSTR directory, LPCSTR dll,
    LPVOID environment, DWORD* pid
) {
    STARTUPINFOW si = {}; si.cb = sizeof(si);
    PROCESS_INFORMATION pi = {};
    BOOL ok = DetourCreateProcessWithDllExW(application, command, NULL, NULL, FALSE,
        CREATE_UNICODE_ENVIRONMENT, environment, directory, &si, &pi, dll, NULL);
    if (ok) {
        if (pid) *pid = pi.dwProcessId;
        CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    }
    return ok;
}

bool WaitForRejectReady(HANDLE process, HANDLE ready) {
    // A process exit may also signal this wait. Only the readiness event
    // confirms that the target installed the required hooks.
    HANDLE handles[] = {ready, process};
    return WaitForMultipleObjects(_countof(handles), handles, FALSE, 5000) == WAIT_OBJECT_0;
}

#if defined(_M_IX86)
#pragma comment(linker, "/EXPORT:PwLaunchProcessWithVerifiedReject=_PwLaunchProcessWithVerifiedReject@24")
#endif
extern "C" __declspec(dllexport) BOOL WINAPI PwLaunchProcessWithVerifiedReject(
    LPCWSTR application, LPWSTR command, LPCWSTR directory, LPCSTR dll,
    LPVOID environment, DWORD* pid
) {
    if (!environment) return FALSE;
    constexpr wchar_t key[] = L"PROCWEAVER_HOOK_CONTROL=";
    HANDLE ready = NULL;
    for (auto* p = static_cast<const wchar_t*>(environment); *p; p += wcslen(p) + 1) {
        if (_wcsnicmp(p, key, _countof(key) - 1) == 0) {
            std::wstring ready_name = p + _countof(key) - 1;
            ready_name += L"_reject_ready";
            ready = OpenEventW(SYNCHRONIZE, FALSE, ready_name.c_str());
            break;
        }
    }
    if (!ready) return FALSE;

    STARTUPINFOW si = {}; si.cb = sizeof(si);
    PROCESS_INFORMATION pi = {};
    BOOL ok = DetourCreateProcessWithDllExW(application, command, NULL, NULL, FALSE,
        CREATE_UNICODE_ENVIRONMENT, environment, directory, &si, &pi, dll, NULL);
    if (ok) {
        ok = WaitForRejectReady(pi.hProcess, ready);
        if (ok) {
            if (pid) *pid = pi.dwProcessId;
        } else {
            TerminateProcess(pi.hProcess, ERROR_ACCESS_DENIED);
        }
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
    }
    CloseHandle(ready);
    return ok;
}

static bool PublishReady() {
    if (!ControlIsLive()) return false;
    wchar_t name[256] = {};
    const wchar_t* suffix = g_policy_resolved ? L"_policy_ready" : L"_ready";
    if (g_config.reject_all) {
        suffix = L"_reject_ready";
        DWORD length = GetEnvironmentVariableW(L"PROCWEAVER_REJECT_READY", name, _countof(name));
        if (length >= _countof(name)) return false;
        if (length != 0) {
            // A caller-suspended child can only publish after its caller resumes
            // it. Its DLL still has to install all REJECT hooks before entry.
            if (wcscmp(name, L"-") == 0) return true;
        }
    }
    if (!name[0]) {
        DWORD length = GetEnvironmentVariableW(L"PROCWEAVER_HOOK_CONTROL", name, 240);
        if (length == 0 || length >= 240) return false;
        wcscat_s(name, suffix);
    }
    HANDLE event = OpenEventW(EVENT_MODIFY_STATE, FALSE, name);
    if (!event) return false;
    BOOL published = SetEvent(event);
    CloseHandle(event);
    return published != FALSE;
}

BOOL WINAPI DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved) {
    (void)lpvReserved;
    if (DetourIsHelperProcess()) {
        return TRUE;
    }

    if (fdwReason == DLL_PROCESS_ATTACH) {
        g_hModule = (HMODULE)hinstDLL;
        DisableThreadLibraryCalls(hinstDLL);

        LoadHookConfig();
        if (g_config.enabled) {
            HookTier tier = HookTier::Failed;
            bool iat_connect_installed = false;
            if (g_config.reject_all) {
                // Import-table hooks alone cannot confirm process-wide socket
                // interception, even when they patch a socket function.
                g_hooks_installed = ControlIsLive() && !IsAcgEnabled() && InstallHooks();
                if (!g_hooks_installed || !PublishReady()) {
                    ReportHookTier(HookTier::Failed);
                    return FALSE;
                }
                tier = HookTier::FullInline;
            } else if (IsAcgEnabled()) {
                g_hooks_installed = InstallIatHooks(iat_connect_installed);
                if (g_hooks_installed) tier = HookTier::IatCompat;
            } else {
                g_hooks_installed = InstallHooks();
                if (g_hooks_installed) {
                    tier = HookTier::FullInline;
                } else {
                    g_hooks_installed = InstallIatHooks(iat_connect_installed);
                    if (g_hooks_installed) tier = HookTier::IatCompat;
                }
            }
            if (g_policy_resolved && tier == HookTier::IatCompat && !iat_connect_installed) {
                tier = HookTier::Failed;
            }
            ReportHookTier(tier);
            if (!g_hooks_installed && g_config.policy.remote_dns_required) return FALSE;
            if (tier != HookTier::Failed && !g_config.reject_all && g_control_required &&
                !ReadEnvBool("PROCWEAVER_HOOK_CHILD", false)) PublishReady();
        }
    } else if (fdwReason == DLL_PROCESS_DETACH) {
        if (g_hooks_installed) {
            UninstallHooks();
        }
        if (g_control_event) CloseHandle(g_control_event);
        if (g_control_host) CloseHandle(g_control_host);
    }
    return TRUE;
}
