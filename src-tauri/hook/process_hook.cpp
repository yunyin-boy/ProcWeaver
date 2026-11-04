#include "process_hook.h"
#include <cwchar>
#include <cstring>
#include <map>

struct EnvLess { bool operator()(const std::wstring& a, const std::wstring& b) const { return _wcsicmp(a.c_str(), b.c_str()) < 0; } };

// Preserve the application's environment while carrying our one-way lease into
// children that supply a sanitized custom block. Never mutate the host's env.
static std::vector<wchar_t> ChildEnvironment(LPVOID supplied, bool unicode) {
    std::map<std::wstring, std::wstring, EnvLess> entries;
    auto add = [&](const std::wstring& entry) {
        auto equal = entry.find(L'=', entry[0] == L'=' ? 1 : 0);
        if (equal != std::wstring::npos) entries[entry.substr(0, equal)] = entry.substr(equal + 1);
    };
    LPWCH parent = GetEnvironmentStringsW();
    if (!parent) return {};
    if (!supplied) { for (auto* p = parent; *p; p += wcslen(p) + 1) add(p); }
    else if (unicode) { for (auto* p = static_cast<wchar_t*>(supplied); *p; p += wcslen(p) + 1) add(p); }
    else {
        for (auto* p = static_cast<char*>(supplied); *p; p += strlen(p) + 1) {
            int size = MultiByteToWideChar(CP_ACP, 0, p, -1, nullptr, 0);
            if (!size) { FreeEnvironmentStringsW(parent); return {}; }
            std::wstring value(size, L'\0'); MultiByteToWideChar(CP_ACP, 0, p, -1, value.data(), size);
            value.pop_back(); add(value);
        }
    }
    for (auto* p = parent; *p; p += wcslen(p) + 1) { if (_wcsnicmp(p, L"PROCWEAVER_", 11) == 0) add(p); }
    FreeEnvironmentStringsW(parent);
    entries[L"PROCWEAVER_BUNDLE_PORT"] = std::to_wstring(g_config.bundle_port);
    entries[L"PROCWEAVER_DNS_PORT"] = std::to_wstring(g_config.dns_port);
    entries[L"PROCWEAVER_DNS_MODE"] = L"fake_ip";
    entries[L"PROCWEAVER_REMOTE_DNS_REQUIRED"] = L"1";
    std::vector<wchar_t> result;
    for (auto& entry : entries) {
        result.insert(result.end(), entry.first.begin(), entry.first.end()); result.push_back(L'=');
        result.insert(result.end(), entry.second.begin(), entry.second.end()); result.push_back(L'\0');
    }
    result.push_back(L'\0'); return result;
}

PFN_CreateProcessW TrueCreateProcessW = CreateProcessW;
PFN_CreateProcessA TrueCreateProcessA = CreateProcessA;

// 判断是否为 Chromium / Electron / Edge WebView2 的受限沙盒子进程
// 渲染进程 (--type=renderer)、GPU 加速 (--type=gpu-process)、崩溃处理器 (--type=crashpad-handler)
// 此类子进程运行在 Windows Restricted Token 沙盒中，受 ACG/CIG 保护，无对外 Socket 网络，
// 且禁止沙盒内加载外部非系统 DLL。若强行注入会导致子进程初始化失败崩溃 (Renderer Crash)，造成主窗口白屏死锁。
static bool ShouldSkipInjectW(LPCWSTR appName, LPCWSTR cmdLine) {
    if (cmdLine) {
        if (wcsstr(cmdLine, L"--type=renderer") != nullptr ||
            wcsstr(cmdLine, L"--type=gpu-process") != nullptr ||
            wcsstr(cmdLine, L"--type=crashpad-handler") != nullptr ||
            wcsstr(cmdLine, L"--type=utility") != nullptr ||
            wcsstr(cmdLine, L"--type=service-worker") != nullptr) {
            return true;
        }
    }
    if (appName) {
        if (wcsstr(appName, L"crashpad_handler") != nullptr) {
            return true;
        }
    }
    return false;
}

static bool ShouldSkipInjectA(LPCSTR appName, LPCSTR cmdLine) {
    if (cmdLine) {
        if (strstr(cmdLine, "--type=renderer") != nullptr ||
            strstr(cmdLine, "--type=gpu-process") != nullptr ||
            strstr(cmdLine, "--type=crashpad-handler") != nullptr ||
            strstr(cmdLine, "--type=utility") != nullptr ||
            strstr(cmdLine, "--type=service-worker") != nullptr) {
            return true;
        }
    }
    if (appName) {
        if (strstr(appName, "crashpad_handler") != nullptr) {
            return true;
        }
    }
    return false;
}

static bool InjectChildProcess(HANDLE hProcess) {
    if (!hProcess) return false;

    BOOL isWow64 = FALSE;
    typedef BOOL (WINAPI *LPFN_ISWOW64PROCESS)(HANDLE, PBOOL);
    static LPFN_ISWOW64PROCESS fnIsWow64 = (LPFN_ISWOW64PROCESS)GetProcAddress(
        GetModuleHandleA("kernel32.dll"), "IsWow64Process"
    );

    if (fnIsWow64) {
        if (!fnIsWow64(hProcess, &isWow64)) return false;
    }

    std::string dir = GetCurrentDllDir();
    std::string target_dll;

#if defined(_WIN64)
    // 64 位环境下，若子进程为 WOW64，则注入 32 位 DLL；否则注入 64 位 DLL
    if (isWow64) {
        target_dll = dir + "\\pw_hook32.dll";
    } else {
        target_dll = dir + "\\pw_hook64.dll";
    }
#else
    // 32 位环境下，只能直接操作 32 位子进程
    target_dll = dir + "\\pw_hook32.dll";
#endif

    // 检查目标 DLL 是否存在
    DWORD attr = GetFileAttributesA(target_dll.c_str());
    if (attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY)) {
        LPCSTR dll_path = target_dll.c_str();
        return DetourUpdateProcessWithDll(hProcess, &dll_path, 1) != FALSE;
    }
    return false;
}

static bool ProtectChild(LPPROCESS_INFORMATION child) {
    if (InjectChildProcess(child->hProcess) || !g_config.policy.remote_dns_required) return true;
    // This is our newly created, still-suspended child. Do not release it into
    // native networking after an injection failure.
    TerminateProcess(child->hProcess, ERROR_DLL_INIT_FAILED);
    WaitForSingleObject(child->hProcess, 1000);
    CloseHandle(child->hThread); CloseHandle(child->hProcess);
    ZeroMemory(child, sizeof(*child)); SetLastError(ERROR_DLL_INIT_FAILED); return false;
}

BOOL WINAPI HookCreateProcessW(
    LPCWSTR lpApplicationName,
    LPWSTR lpCommandLine,
    LPSECURITY_ATTRIBUTES lpProcessAttributes,
    LPSECURITY_ATTRIBUTES lpThreadAttributes,
    BOOL bInheritHandles,
    DWORD dwCreationFlags,
    LPVOID lpEnvironment,
    LPCWSTR lpCurrentDirectory,
    LPSTARTUPINFOW lpStartupInfo,
    LPPROCESS_INFORMATION lpProcessInformation
) {
    if (!IsHookEnabled() || !g_config.policy.proxy_subprocesses || ShouldSkipInjectW(lpApplicationName, lpCommandLine)) {
        return TrueCreateProcessW(
            lpApplicationName, lpCommandLine, lpProcessAttributes,
            lpThreadAttributes, bInheritHandles, dwCreationFlags,
            lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
        );
    }

    bool was_suspended = (dwCreationFlags & CREATE_SUSPENDED) != 0;
    DWORD modified_flags = dwCreationFlags | CREATE_SUSPENDED;

    std::vector<wchar_t> environment;
    if (g_config.policy.remote_dns_required) {
        environment = ChildEnvironment(lpEnvironment, (dwCreationFlags & CREATE_UNICODE_ENVIRONMENT) != 0);
        if (environment.empty()) { SetLastError(ERROR_NOT_ENOUGH_MEMORY); return FALSE; }
        lpEnvironment = environment.data(); modified_flags |= CREATE_UNICODE_ENVIRONMENT;
    }

    BOOL ok = TrueCreateProcessW(
        lpApplicationName, lpCommandLine, lpProcessAttributes,
        lpThreadAttributes, bInheritHandles, modified_flags,
        lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
    );

    if (!ok) return FALSE;

    if (lpProcessInformation && lpProcessInformation->hProcess) {
        if (!ProtectChild(lpProcessInformation)) return FALSE;

        // 如果调用方本来未要求挂起，则恢复主线程
        if (!was_suspended && lpProcessInformation->hThread) {
            ResumeThread(lpProcessInformation->hThread);
        }
    }

    return TRUE;
}

BOOL WINAPI HookCreateProcessA(
    LPCSTR lpApplicationName,
    LPSTR lpCommandLine,
    LPSECURITY_ATTRIBUTES lpProcessAttributes,
    LPSECURITY_ATTRIBUTES lpThreadAttributes,
    BOOL bInheritHandles,
    DWORD dwCreationFlags,
    LPVOID lpEnvironment,
    LPCSTR lpCurrentDirectory,
    LPSTARTUPINFOA lpStartupInfo,
    LPPROCESS_INFORMATION lpProcessInformation
) {
    if (!IsHookEnabled() || !g_config.policy.proxy_subprocesses || ShouldSkipInjectA(lpApplicationName, lpCommandLine)) {
        return TrueCreateProcessA(
            lpApplicationName, lpCommandLine, lpProcessAttributes,
            lpThreadAttributes, bInheritHandles, dwCreationFlags,
            lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
        );
    }

    bool was_suspended = (dwCreationFlags & CREATE_SUSPENDED) != 0;
    DWORD modified_flags = dwCreationFlags | CREATE_SUSPENDED;

    std::vector<wchar_t> environment;
    if (g_config.policy.remote_dns_required) {
        environment = ChildEnvironment(lpEnvironment, (dwCreationFlags & CREATE_UNICODE_ENVIRONMENT) != 0);
        if (environment.empty()) { SetLastError(ERROR_NOT_ENOUGH_MEMORY); return FALSE; }
        lpEnvironment = environment.data(); modified_flags |= CREATE_UNICODE_ENVIRONMENT;
    }

    BOOL ok = TrueCreateProcessA(
        lpApplicationName, lpCommandLine, lpProcessAttributes,
        lpThreadAttributes, bInheritHandles, modified_flags,
        lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
    );

    if (!ok) return FALSE;

    if (lpProcessInformation && lpProcessInformation->hProcess) {
        if (!ProtectChild(lpProcessInformation)) return FALSE;

        if (!was_suspended && lpProcessInformation->hThread) {
            ResumeThread(lpProcessInformation->hThread);
        }
    }

    return TRUE;
}
