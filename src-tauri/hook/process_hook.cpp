#include "process_hook.h"
#include <cwchar>
#include <cstring>
#include <map>

struct EnvLess { bool operator()(const std::wstring& a, const std::wstring& b) const { return _wcsicmp(a.c_str(), b.c_str()) < 0; } };

static std::wstring ExtractExeNameW(LPCWSTR appName, LPCWSTR cmdLine) {
    std::wstring raw;
    if (appName && appName[0]) {
        raw = appName;
    } else if (cmdLine && cmdLine[0]) {
        if (cmdLine[0] == L'"') {
            const wchar_t* end = wcschr(cmdLine + 1, L'"');
            if (end) raw = std::wstring(cmdLine + 1, end - cmdLine - 1);
            else raw = cmdLine + 1;
        } else {
            const wchar_t* end = wcschr(cmdLine, L' ');
            if (end) raw = std::wstring(cmdLine, end - cmdLine);
            else raw = cmdLine;
        }
    }
    size_t last_slash = raw.find_last_of(L"\\/");
    if (last_slash != std::wstring::npos) {
        raw = raw.substr(last_slash + 1);
    }
    for (auto& c : raw) c = (wchar_t)towlower(c);
    return raw;
}

static std::string WStringToNarrow(const std::wstring& w) {
    if (w.empty()) return {};
    int size = WideCharToMultiByte(CP_ACP, 0, w.c_str(), (int)w.length(), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string s(size, '\0');
    WideCharToMultiByte(CP_ACP, 0, w.c_str(), (int)w.length(), &s[0], size, nullptr, nullptr);
    return s;
}

// Preserve the application's environment while carrying our one-way lease into
// children that supply a sanitized custom block. Never mutate the host's env.
static std::vector<wchar_t> ChildEnvironment(LPVOID supplied, bool unicode, const std::wstring& childExeName) {
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
            std::wstring value(size, L'\0'); MultiByteToWideChar(CP_ACP, 0, p, -1, &value[0], size);
            value.pop_back(); add(value);
        }
    }
    for (auto* p = parent; *p; p += wcslen(p) + 1) { if (_wcsnicmp(p, L"PROCWEAVER_", 11) == 0) add(p); }
    FreeEnvironmentStringsW(parent);

    // 重新解析子进程自身的专有规则 (避免固定继承父进程端口)
    uint16_t effective_port = g_config.policy.proxy_subprocesses ? g_config.bundle_port : 0;
    bool has_explicit_rule = false;
    if (!childExeName.empty() && !g_config.override_rules.empty()) {
        std::string narrowExe = WStringToNarrow(childExeName);
        std::string rules = g_config.override_rules;
        for (auto& c : rules) c = (char)tolower(c);
        std::string pattern = narrowExe + "=";
        size_t pos = rules.find(pattern);
        if (pos != std::string::npos) {
            has_explicit_rule = true;
            size_t val_start = pos + pattern.length();
            size_t val_end = rules.find(';', val_start);
            if (val_end == std::string::npos) val_end = rules.length();
            std::string action = rules.substr(val_start, val_end - val_start);
            if (action == "direct") {
                effective_port = 0;
                entries[L"PROCWEAVER_ACTION"] = L"DIRECT";
            } else if (action == "reject") {
                entries[L"PROCWEAVER_ACTION"] = L"REJECT";
            } else {
                int p = atoi(action.c_str());
                if (p > 0 && p <= 65535) {
                    effective_port = (uint16_t)p;
                }
            }
        }
    }

    entries[L"PROCWEAVER_BUNDLE_PORT"] = std::to_wstring(effective_port);
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
        // Chromium NetworkService 负责所有实际网络连接，必须强制受控注入
        if (wcsstr(cmdLine, L"network.mojom.NetworkService") != nullptr) {
            return false;
        }
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
        // Chromium NetworkService 负责所有实际网络连接，必须强制受控注入
        if (strstr(cmdLine, "network.mojom.NetworkService") != nullptr) {
            return false;
        }
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

static bool ProtectChild(LPPROCESS_INFORMATION child, const std::wstring& childExeName) {
    if (InjectChildProcess(child->hProcess)) return true;
    std::string narrowName = WStringToNarrow(childExeName);
    ReportChildHookFailed(child->dwProcessId, narrowName.c_str());
    return true;
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
    if (!IsHookEnabled() || ShouldSkipInjectW(lpApplicationName, lpCommandLine)) {
        return TrueCreateProcessW(
            lpApplicationName, lpCommandLine, lpProcessAttributes,
            lpThreadAttributes, bInheritHandles, dwCreationFlags,
            lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
        );
    }

    std::wstring childExe = ExtractExeNameW(lpApplicationName, lpCommandLine);
    bool was_suspended = (dwCreationFlags & CREATE_SUSPENDED) != 0;
    DWORD modified_flags = dwCreationFlags | CREATE_SUSPENDED;

    std::vector<wchar_t> environment = ChildEnvironment(lpEnvironment, (dwCreationFlags & CREATE_UNICODE_ENVIRONMENT) != 0, childExe);
    if (!environment.empty()) {
        lpEnvironment = environment.data();
        modified_flags |= CREATE_UNICODE_ENVIRONMENT;
    }

    BOOL ok = TrueCreateProcessW(
        lpApplicationName, lpCommandLine, lpProcessAttributes,
        lpThreadAttributes, bInheritHandles, modified_flags,
        lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
    );

    if (!ok) return FALSE;

    if (lpProcessInformation && lpProcessInformation->hProcess) {
        if (!ProtectChild(lpProcessInformation, childExe)) return FALSE;

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
    if (!IsHookEnabled() || ShouldSkipInjectA(lpApplicationName, lpCommandLine)) {
        return TrueCreateProcessA(
            lpApplicationName, lpCommandLine, lpProcessAttributes,
            lpThreadAttributes, bInheritHandles, dwCreationFlags,
            lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
        );
    }

    int appLen = lpApplicationName ? MultiByteToWideChar(CP_ACP, 0, lpApplicationName, -1, nullptr, 0) : 0;
    std::wstring appNameW(appLen, L'\0');
    if (appLen > 0) MultiByteToWideChar(CP_ACP, 0, lpApplicationName, -1, &appNameW[0], appLen);

    int cmdLen = lpCommandLine ? MultiByteToWideChar(CP_ACP, 0, lpCommandLine, -1, nullptr, 0) : 0;
    std::wstring cmdLineW(cmdLen, L'\0');
    if (cmdLen > 0) MultiByteToWideChar(CP_ACP, 0, lpCommandLine, -1, &cmdLineW[0], cmdLen);

    std::wstring childExe = ExtractExeNameW(appLen > 0 ? appNameW.c_str() : nullptr, cmdLen > 0 ? cmdLineW.c_str() : nullptr);

    bool was_suspended = (dwCreationFlags & CREATE_SUSPENDED) != 0;
    DWORD modified_flags = dwCreationFlags | CREATE_SUSPENDED;

    std::vector<wchar_t> environment = ChildEnvironment(lpEnvironment, (dwCreationFlags & CREATE_UNICODE_ENVIRONMENT) != 0, childExe);
    if (!environment.empty()) {
        lpEnvironment = environment.data();
        modified_flags |= CREATE_UNICODE_ENVIRONMENT;
    }

    BOOL ok = TrueCreateProcessA(
        lpApplicationName, lpCommandLine, lpProcessAttributes,
        lpThreadAttributes, bInheritHandles, modified_flags,
        lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
    );

    if (!ok) return FALSE;

    if (lpProcessInformation && lpProcessInformation->hProcess) {
        if (!ProtectChild(lpProcessInformation, childExe)) return FALSE;

        if (!was_suspended && lpProcessInformation->hThread) {
            ResumeThread(lpProcessInformation->hThread);
        }
    }

    return TRUE;
}
