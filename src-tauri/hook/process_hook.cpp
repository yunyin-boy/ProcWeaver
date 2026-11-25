#include "process_hook.h"
#include <atomic>
#include <cwchar>
#include <cstring>
#include <map>

struct EnvLess { bool operator()(const std::wstring& a, const std::wstring& b) const { return _wcsicmp(a.c_str(), b.c_str()) < 0; } };

struct ChildTargetInfo {
    std::wstring full_path;
    std::wstring exe_name;
};

static ChildTargetInfo ExtractTargetInfoW(LPCWSTR appName, LPCWSTR cmdLine) {
    std::wstring raw;
    if (appName && appName[0]) {
        raw = appName;
    } else if (cmdLine && cmdLine[0]) {
        const wchar_t* cursor = cmdLine;
        while (*cursor == L' ' || *cursor == L'\t') ++cursor;
        if (*cursor == L'"') {
            const wchar_t* end = wcschr(cursor + 1, L'"');
            if (end) raw = std::wstring(cursor + 1, end - cursor - 1);
            else raw = cursor + 1;
        } else {
            const wchar_t* end = wcspbrk(cursor, L" \t");
            if (end) raw = std::wstring(cursor, end - cursor);
            else raw = cursor;
        }
    }
    ChildTargetInfo info;
    if (raw.find(L'\\') != std::wstring::npos || raw.find(L'/') != std::wstring::npos) {
        WCHAR absBuf[MAX_PATH] = { 0 };
        DWORD n = GetFullPathNameW(raw.c_str(), MAX_PATH, absBuf, nullptr);
        info.full_path = (n > 0 && n < MAX_PATH) ? std::wstring(absBuf) : raw;
        for (auto& c : info.full_path) {
            if (c == L'/') c = L'\\';
            c = (wchar_t)towlower(c);
        }
    }
    size_t last_slash = raw.find_last_of(L"\\/");
    info.exe_name = (last_slash != std::wstring::npos) ? raw.substr(last_slash + 1) : raw;
    for (auto& c : info.exe_name) c = (wchar_t)towlower(c);
    return info;
}

static std::string WStringToNarrow(const std::wstring& w) {
    if (w.empty()) return {};
    int size = WideCharToMultiByte(CP_ACP, 0, w.c_str(), (int)w.length(), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string s(size, '\0');
    WideCharToMultiByte(CP_ACP, 0, w.c_str(), (int)w.length(), &s[0], size, nullptr, nullptr);
    return s;
}

struct RejectChildReady {
    HANDLE event = NULL;
    std::wstring name;

    ~RejectChildReady() { if (event) CloseHandle(event); }

    bool Prepare(bool suspended) {
        wchar_t lease[256] = {};
        DWORD length = GetEnvironmentVariableW(L"PROCWEAVER_HOOK_CONTROL", lease, _countof(lease));
        if (length == 0 || length >= _countof(lease)) return false;
        if (suspended) {
            name = L"-";
            return true;
        }
        static std::atomic<uint32_t> serial{0};
        name = std::wstring(lease) + L"_child_" + std::to_wstring(GetCurrentProcessId()) +
            L"_" + std::to_wstring(++serial);
        event = CreateEventW(NULL, TRUE, FALSE, name.c_str());
        return event && GetLastError() != ERROR_ALREADY_EXISTS;
    }
};

// Preserve the application's environment while carrying our one-way lease into
// children that need Hook protection; sanitize PROCWEAVER_* for excluded ones.
static std::vector<wchar_t> BuildChildEnvironment(
    LPVOID supplied,
    bool unicode,
    const ChildTargetInfo& target,
    bool suspended,
    RejectChildReady& ready,
    bool& out_should_inject,
    bool& is_reject
) {
    std::string fullNarrow = WStringToNarrow(target.full_path);
    std::string nameNarrow = WStringToNarrow(target.exe_name);
    std::string matchedAction = LookupOverrideRuleAction(g_config.override_rules, fullNarrow, nameNarrow);

    uint16_t effective_port = 0;
    bool is_direct = false;

    if (!matchedAction.empty()) {
        if (matchedAction == "direct") {
            is_direct = true;
            out_should_inject = false;
        } else if (matchedAction == "reject") {
            is_reject = true;
            out_should_inject = true;
        } else {
            int p = atoi(matchedAction.c_str());
            if (p > 0 && p <= 65535) {
                effective_port = (uint16_t)p;
                out_should_inject = true;
            } else {
                out_should_inject = false;
            }
        }
    } else if (g_config.policy.proxy_subprocesses) {
        if (g_config.reject_all) {
            is_reject = true;
            out_should_inject = true;
        } else if (g_config.bundle_port > 0) {
            effective_port = g_config.bundle_port;
            out_should_inject = true;
        } else {
            out_should_inject = false;
        }
    } else {
        out_should_inject = false;
    }

    if (is_reject && !ready.Prepare(suspended)) return {};
    std::map<std::wstring, std::wstring, EnvLess> entries;
    auto add = [&](const std::wstring& entry) {
        auto equal = entry.find(L'=', entry[0] == L'=' ? 1 : 0);
        if (equal != std::wstring::npos) entries[entry.substr(0, equal)] = entry.substr(equal + 1);
    };
    LPWCH parent = GetEnvironmentStringsW();
    if (!parent) { out_should_inject = false; return {}; }
    if (!supplied) { for (auto* p = parent; *p; p += wcslen(p) + 1) add(p); }
    else if (unicode) { for (auto* p = static_cast<wchar_t*>(supplied); *p; p += wcslen(p) + 1) add(p); }
    else {
        for (auto* p = static_cast<char*>(supplied); *p; p += strlen(p) + 1) {
            int size = MultiByteToWideChar(CP_ACP, 0, p, -1, nullptr, 0);
            if (!size) { FreeEnvironmentStringsW(parent); out_should_inject = false; return {}; }
            std::wstring value(size, L'\0'); MultiByteToWideChar(CP_ACP, 0, p, -1, &value[0], size);
            value.pop_back(); add(value);
        }
    }

    if (out_should_inject) {
        for (auto* p = parent; *p; p += wcslen(p) + 1) { if (_wcsnicmp(p, L"PROCWEAVER_", 11) == 0) add(p); }
        FreeEnvironmentStringsW(parent);

        entries.erase(L"PROCWEAVER_ACTION");
        entries.erase(L"PROCWEAVER_REJECT_READY");
        entries[L"PROCWEAVER_HOOK_CHILD"] = L"1";
        if (is_reject) {
            entries[L"PROCWEAVER_BUNDLE_PORT"] = L"0";
            entries[L"PROCWEAVER_ACTION"] = L"REJECT";
            entries[L"PROCWEAVER_REJECT_READY"] = ready.name;
        } else {
            entries[L"PROCWEAVER_BUNDLE_PORT"] = std::to_wstring(effective_port);
        }
        entries[L"PROCWEAVER_DNS_PORT"] = std::to_wstring(g_config.dns_port);
        if (!is_reject && g_config.policy.core_listener && effective_port != g_config.bundle_port) {
            // An independently matched rule cannot inherit the parent's DNS exception or scope.
            entries[L"PROCWEAVER_DNS_MODE"] = L"fake_ip";
            entries[L"PROCWEAVER_REMOTE_DNS_REQUIRED"] = L"1";
            entries[L"PROCWEAVER_SCOPED_DNS"] = L"0";
            entries.erase(L"PROCWEAVER_NATIVE_DNS_SERVERS");
        }
    } else {
        FreeEnvironmentStringsW(parent);
        for (auto it = entries.begin(); it != entries.end(); ) {
            if (_wcsnicmp(it->first.c_str(), L"PROCWEAVER_", 11) == 0) {
                it = entries.erase(it);
            } else {
                ++it;
            }
        }
        if (is_direct) {
            entries.erase(L"HTTP_PROXY");
            entries.erase(L"HTTPS_PROXY");
            entries.erase(L"ALL_PROXY");
            entries.erase(L"http_proxy");
            entries.erase(L"https_proxy");
            entries.erase(L"all_proxy");
        }
    }

    std::vector<wchar_t> result;
    for (auto& entry : entries) {
        result.insert(result.end(), entry.first.begin(), entry.first.end()); result.push_back(L'=');
        result.insert(result.end(), entry.second.begin(), entry.second.end()); result.push_back(L'\0');
    }
    result.push_back(L'\0');
    return result;
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

static bool InjectChildProcess(HANDLE hProcess, DWORD dwProcessId) {
    if (!hProcess) return false;

    BOOL targetIsWow64 = FALSE;
    typedef BOOL (WINAPI *LPFN_ISWOW64PROCESS)(HANDLE, PBOOL);
    static LPFN_ISWOW64PROCESS fnIsWow64 = (LPFN_ISWOW64PROCESS)GetProcAddress(
        GetModuleHandleA("kernel32.dll"), "IsWow64Process"
    );

    BOOL is64BitOS = FALSE;
#if defined(_WIN64)
    is64BitOS = TRUE;
#else
    BOOL selfIsWow64 = FALSE;
    if (fnIsWow64 && fnIsWow64(GetCurrentProcess(), &selfIsWow64)) {
        is64BitOS = selfIsWow64;
    }
#endif

    bool targetIs32 = true;
    if (is64BitOS) {
        if (!fnIsWow64 || !fnIsWow64(hProcess, &targetIsWow64)) return false;
        targetIs32 = (targetIsWow64 != FALSE);
    }

    std::string target_dll = GetCurrentDllDir() + (targetIs32 ? "\\pw_hook32.dll" : "\\pw_hook64.dll");
    DWORD attr = GetFileAttributesA(target_dll.c_str());
    if (attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY)) {
        LPCSTR dll_path = target_dll.c_str();
        if (DetourUpdateProcessWithDll(hProcess, &dll_path, 1) != FALSE) {
            return true;
        }
        // 跨位宽场景（x64 -> x86 或 x86 -> x64）必须由 Detours Helper 完成导入表重写
        return DetourProcessViaHelperDllsW(dwProcessId, 1, &dll_path, TrueCreateProcessW) != FALSE;
    }
    return false;
}

static bool ProtectChild(LPPROCESS_INFORMATION child, const ChildTargetInfo& target, bool reject) {
    if (InjectChildProcess(child->hProcess, child->dwProcessId)) return true;
    std::string narrowName = WStringToNarrow(target.exe_name);
    ReportChildHookFailed(child->dwProcessId, narrowName.c_str());
    return !reject;
}

static BOOL FinishChild(LPPROCESS_INFORMATION child, const ChildTargetInfo& target,
    bool was_suspended, bool reject, HANDLE ready) {
    if (ProtectChild(child, target, reject)) {
        if (was_suspended) return TRUE;
        DWORD previous_suspend_count = ResumeThread(child->hThread);
        if (!reject || (previous_suspend_count == 1 && WaitForRejectReady(child->hProcess, ready))) {
            return TRUE;
        }
    }
    TerminateProcess(child->hProcess, ERROR_ACCESS_DENIED);
    CloseHandle(child->hThread);
    CloseHandle(child->hProcess);
    ZeroMemory(child, sizeof(*child));
    SetLastError(ERROR_ACCESS_DENIED);
    return FALSE;
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
    if (!IsHookEnabled()) {
        return TrueCreateProcessW(
            lpApplicationName, lpCommandLine, lpProcessAttributes,
            lpThreadAttributes, bInheritHandles, dwCreationFlags,
            lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
        );
    }

    ChildTargetInfo target = ExtractTargetInfoW(lpApplicationName, lpCommandLine);
    bool should_inject = false;
    bool reject = false;
    bool was_suspended = (dwCreationFlags & CREATE_SUSPENDED) != 0;
    RejectChildReady ready;
    std::vector<wchar_t> environment = BuildChildEnvironment(
        lpEnvironment,
        (dwCreationFlags & CREATE_UNICODE_ENVIRONMENT) != 0,
        target,
        was_suspended,
        ready,
        should_inject,
        reject
    );

    if (reject && environment.empty()) {
        SetLastError(ERROR_ACCESS_DENIED);
        return FALSE;
    }
    if (!reject && ShouldSkipInjectW(lpApplicationName, lpCommandLine)) {
        should_inject = false;
    } else if (!environment.empty()) {
        lpEnvironment = environment.data();
        dwCreationFlags |= CREATE_UNICODE_ENVIRONMENT;
    }

    if (!should_inject) {
        // 子进程明确直连或父规则关闭继承且子进程无规则：保留清洗后的无 PROCWEAVER_* 环境直接原生启动
        return TrueCreateProcessW(
            lpApplicationName, lpCommandLine, lpProcessAttributes,
            lpThreadAttributes, bInheritHandles, dwCreationFlags,
            lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
        );
    }

    DWORD modified_flags = dwCreationFlags | CREATE_SUSPENDED;

    BOOL ok = TrueCreateProcessW(
        lpApplicationName, lpCommandLine, lpProcessAttributes,
        lpThreadAttributes, bInheritHandles, modified_flags,
        lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
    );

    if (!ok) return FALSE;

    return FinishChild(lpProcessInformation, target, was_suspended, reject, ready.event);
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
    if (!IsHookEnabled()) {
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

    ChildTargetInfo target = ExtractTargetInfoW(
        appLen > 0 ? appNameW.c_str() : nullptr,
        cmdLen > 0 ? cmdLineW.c_str() : nullptr
    );

    bool should_inject = false;
    bool reject = false;
    bool was_suspended = (dwCreationFlags & CREATE_SUSPENDED) != 0;
    RejectChildReady ready;
    std::vector<wchar_t> environment = BuildChildEnvironment(
        lpEnvironment,
        (dwCreationFlags & CREATE_UNICODE_ENVIRONMENT) != 0,
        target,
        was_suspended,
        ready,
        should_inject,
        reject
    );

    if (reject && environment.empty()) {
        SetLastError(ERROR_ACCESS_DENIED);
        return FALSE;
    }
    if (!reject && ShouldSkipInjectA(lpApplicationName, lpCommandLine)) {
        should_inject = false;
    } else if (!environment.empty()) {
        lpEnvironment = environment.data();
        dwCreationFlags |= CREATE_UNICODE_ENVIRONMENT;
    }

    if (!should_inject) {
        return TrueCreateProcessA(
            lpApplicationName, lpCommandLine, lpProcessAttributes,
            lpThreadAttributes, bInheritHandles, dwCreationFlags,
            lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
        );
    }

    DWORD modified_flags = dwCreationFlags | CREATE_SUSPENDED;

    BOOL ok = TrueCreateProcessA(
        lpApplicationName, lpCommandLine, lpProcessAttributes,
        lpThreadAttributes, bInheritHandles, modified_flags,
        lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
    );

    if (!ok) return FALSE;

    return FinishChild(lpProcessInformation, target, was_suspended, reject, ready.event);
}
