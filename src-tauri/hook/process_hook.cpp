#include "process_hook.h"
#include <cwchar>
#include <cstring>

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

static void InjectChildProcess(HANDLE hProcess) {
    if (!hProcess) return;

    BOOL isWow64 = FALSE;
    typedef BOOL (WINAPI *LPFN_ISWOW64PROCESS)(HANDLE, PBOOL);
    static LPFN_ISWOW64PROCESS fnIsWow64 = (LPFN_ISWOW64PROCESS)GetProcAddress(
        GetModuleHandleA("kernel32.dll"), "IsWow64Process"
    );

    if (fnIsWow64) {
        fnIsWow64(hProcess, &isWow64);
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
        DetourUpdateProcessWithDll(hProcess, &dll_path, 1);
    }
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
    if (!g_config.enabled || !g_config.policy.proxy_subprocesses || ShouldSkipInjectW(lpApplicationName, lpCommandLine)) {
        return TrueCreateProcessW(
            lpApplicationName, lpCommandLine, lpProcessAttributes,
            lpThreadAttributes, bInheritHandles, dwCreationFlags,
            lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
        );
    }

    bool was_suspended = (dwCreationFlags & CREATE_SUSPENDED) != 0;
    DWORD modified_flags = dwCreationFlags | CREATE_SUSPENDED;

    BOOL ok = TrueCreateProcessW(
        lpApplicationName, lpCommandLine, lpProcessAttributes,
        lpThreadAttributes, bInheritHandles, modified_flags,
        lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
    );

    if (!ok) return FALSE;

    if (lpProcessInformation && lpProcessInformation->hProcess) {
        InjectChildProcess(lpProcessInformation->hProcess);

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
    if (!g_config.enabled || !g_config.policy.proxy_subprocesses || ShouldSkipInjectA(lpApplicationName, lpCommandLine)) {
        return TrueCreateProcessA(
            lpApplicationName, lpCommandLine, lpProcessAttributes,
            lpThreadAttributes, bInheritHandles, dwCreationFlags,
            lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
        );
    }

    bool was_suspended = (dwCreationFlags & CREATE_SUSPENDED) != 0;
    DWORD modified_flags = dwCreationFlags | CREATE_SUSPENDED;

    BOOL ok = TrueCreateProcessA(
        lpApplicationName, lpCommandLine, lpProcessAttributes,
        lpThreadAttributes, bInheritHandles, modified_flags,
        lpEnvironment, lpCurrentDirectory, lpStartupInfo, lpProcessInformation
    );

    if (!ok) return FALSE;

    if (lpProcessInformation && lpProcessInformation->hProcess) {
        InjectChildProcess(lpProcessInformation->hProcess);

        if (!was_suspended && lpProcessInformation->hThread) {
            ResumeThread(lpProcessInformation->hThread);
        }
    }

    return TRUE;
}
