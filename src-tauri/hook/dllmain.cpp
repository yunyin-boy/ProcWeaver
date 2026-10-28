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
