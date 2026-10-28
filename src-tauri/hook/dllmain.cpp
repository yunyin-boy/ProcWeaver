#define _CRT_SECURE_NO_WARNINGS
#include "pw_common.h"
#include "dns_hook.h"
#include "socket_hook.h"
#include "process_hook.h"

HookConfig g_config = {
    0, 45053, false,
    { true, true, true, false, true, true, DnsMode::SafePure, PortFilterMode::All, {}, TargetFilterMode::All, {} }
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

void LoadHookConfig() {
    char bundle_buf[32] = { 0 };
    DWORD r1 = GetEnvironmentVariableA("PROCWEAVER_BUNDLE_PORT", bundle_buf, sizeof(bundle_buf));
    if (r1 > 0 && r1 < sizeof(bundle_buf)) {
        int port = atoi(bundle_buf);
        if (port > 0 && port <= 65535) {
            g_config.bundle_port = (uint16_t)port;
            g_config.enabled = true;
        }
    }

    char dns_buf[32] = { 0 };
    DWORD r2 = GetEnvironmentVariableA("PROCWEAVER_DNS_PORT", dns_buf, sizeof(dns_buf));
    if (r2 > 0 && r2 < sizeof(dns_buf)) {
        int dport = atoi(dns_buf);
        if (dport > 0 && dport <= 65535) {
            g_config.dns_port = (uint16_t)dport;
        }
    }

    // 读取精细化策略配置
    g_config.policy.proxy_tcp = ReadEnvBool("PROCWEAVER_PROXY_TCP", true);
    g_config.policy.block_ipv6 = ReadEnvBool("PROCWEAVER_BLOCK_IPV6", true);
    g_config.policy.block_udp = ReadEnvBool("PROCWEAVER_BLOCK_UDP", true);
    g_config.policy.proxy_udp = ReadEnvBool("PROCWEAVER_PROXY_UDP", false);
    g_config.policy.proxy_subprocesses = ReadEnvBool("PROCWEAVER_PROXY_SUBPROCESSES", true);
    g_config.policy.bypass_lan = ReadEnvBool("PROCWEAVER_BYPASS_LAN", true);

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

static bool InstallIatHooks() {
    HMODULE hMain = GetModuleHandle(NULL);
    if (!hMain) return false;

    bool hooked_any = false;
    if (HookIatEntry(hMain, "ws2_32.dll", "connect", (void*)HookConnect, (void**)&TrueConnect)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "WSAConnect", (void*)HookWSAConnect, (void**)&TrueWSAConnect)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "sendto", (void*)HookSendTo, (void**)&TrueSendTo)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "WSASendTo", (void*)HookWSASendTo, (void**)&TrueWSASendTo)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "getaddrinfo", (void*)HookGetAddrInfo, (void**)&TrueGetAddrInfo)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "GetAddrInfoW", (void*)HookGetAddrInfoW, (void**)&TrueGetAddrInfoW)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "freeaddrinfo", (void*)HookFreeAddrInfo, (void**)&TrueFreeAddrInfo)) hooked_any = true;
    if (HookIatEntry(hMain, "ws2_32.dll", "FreeAddrInfoW", (void*)HookFreeAddrInfoW, (void**)&TrueFreeAddrInfoW)) hooked_any = true;

    if (HookIatEntry(hMain, "kernel32.dll", "CreateProcessW", (void*)HookCreateProcessW, (void**)&TrueCreateProcessW)) hooked_any = true;
    if (HookIatEntry(hMain, "kernel32.dll", "CreateProcessA", (void*)HookCreateProcessA, (void**)&TrueCreateProcessA)) hooked_any = true;

    return hooked_any;
}

void ReportHookTier(HookTier tier) {
    g_hook_tier = tier;
    HANDLE hMap = CreateFileMappingA(
        INVALID_HANDLE_VALUE,
        NULL,
        PAGE_READWRITE,
        0,
        sizeof(HookStatusMap),
        "Local\\ProcWeaver_Hook_Tiers"
    );
    if (!hMap) return;

    HookStatusMap* map = (HookStatusMap*)MapViewOfFile(hMap, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(HookStatusMap));
    if (map) {
        if (map->magic != 0x5057484B) {
            map->magic = 0x5057484B; // "PWHK"
            map->count = 0;
        }
        DWORD pid = GetCurrentProcessId();
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
            map->records[found_idx].bundle_port = g_config.bundle_port;
            map->records[found_idx].timestamp_ms = (uint64_t)GetTickCount();
            char fullPath[MAX_PATH] = { 0 };
            GetModuleFileNameA(NULL, fullPath, MAX_PATH);
            const char* baseName = strrchr(fullPath, '\\');
            const char* name = baseName ? (baseName + 1) : fullPath;
            strncpy(map->records[found_idx].process_name, name, sizeof(map->records[found_idx].process_name) - 1);
        }
        UnmapViewOfFile(map);
    }
    static HANDLE s_hMapKeepAlive = hMap;
}

extern "C" __declspec(dllexport) DWORD WINAPI PwGetHookTier() {
    return (DWORD)g_hook_tier;
}

static void InstallHooks() {
    DetourRestoreAfterWith();

    DetourTransactionBegin();
    DetourUpdateThread(GetCurrentThread());

    // 挂钩 DNS 解析 (路线 B)
    DetourAttach(&(PVOID&)TrueGetAddrInfo, (PVOID)HookGetAddrInfo);
    DetourAttach(&(PVOID&)TrueGetAddrInfoW, (PVOID)HookGetAddrInfoW);
    DetourAttach(&(PVOID&)TrueFreeAddrInfo, (PVOID)HookFreeAddrInfo);
    DetourAttach(&(PVOID&)TrueFreeAddrInfoW, (PVOID)HookFreeAddrInfoW);

    // 挂钩网络流量重定向与 QUIC 快速降级
    DetourAttach(&(PVOID&)TrueConnect, (PVOID)HookConnect);
    DetourAttach(&(PVOID&)TrueWSAConnect, (PVOID)HookWSAConnect);
    DetourAttach(&(PVOID&)TrueSendTo, (PVOID)HookSendTo);
    DetourAttach(&(PVOID&)TrueWSASendTo, (PVOID)HookWSASendTo);

    // 挂钩进程衍生追踪
    DetourAttach(&(PVOID&)TrueCreateProcessW, (PVOID)HookCreateProcessW);
    DetourAttach(&(PVOID&)TrueCreateProcessA, (PVOID)HookCreateProcessA);

    DetourTransactionCommit();
}

static void UninstallHooks() {
    DetourTransactionBegin();
    DetourUpdateThread(GetCurrentThread());

    DetourDetach(&(PVOID&)TrueGetAddrInfo, (PVOID)HookGetAddrInfo);
    DetourDetach(&(PVOID&)TrueGetAddrInfoW, (PVOID)HookGetAddrInfoW);
    DetourDetach(&(PVOID&)TrueFreeAddrInfo, (PVOID)HookFreeAddrInfo);
    DetourDetach(&(PVOID&)TrueFreeAddrInfoW, (PVOID)HookFreeAddrInfoW);

    DetourDetach(&(PVOID&)TrueConnect, (PVOID)HookConnect);
    DetourDetach(&(PVOID&)TrueWSAConnect, (PVOID)HookWSAConnect);
    DetourDetach(&(PVOID&)TrueSendTo, (PVOID)HookSendTo);
    DetourDetach(&(PVOID&)TrueWSASendTo, (PVOID)HookWSASendTo);

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
            InstallHooks();
        }
    } else if (fdwReason == DLL_PROCESS_DETACH) {
        if (g_config.enabled) {
            UninstallHooks();
        }
    }
    return TRUE;
}
