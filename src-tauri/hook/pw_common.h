#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <vector>
#include <unordered_set>
#include <mutex>

#include "detours/include/detours.h"

#pragma comment(lib, "ws2_32.lib")

enum class DnsMode {
    SafePure = 0,
    FakeIp = 1,
    SystemNative = 2
};

enum class PortFilterMode {
    All = 0,
    WebOnly = 1,
    Custom = 2
};

enum class TargetFilterMode {
    All = 0,
    Include = 1,
    Exclude = 2
};

enum class HookTier : uint32_t {
    Unknown = 0,
    FullInline = 1,   // Detours Inline Hook 生效
    IatCompat = 2,    // IAT 导入表 Hook 生效 (ACG 降级)
    NativeBypass = 3, // 沙盒 / 强签名跳过 (原生代理参数直通)
    Failed = 4        // 挂钩失败
};

#pragma pack(push, 1)
struct HookProcessRecord {
    uint32_t pid;
    uint32_t hook_tier; // 对应 HookTier
    char process_name[64];
    uint32_t bundle_port;
    uint64_t timestamp_ms;
};

struct HookStatusMap {
    uint32_t magic; // 0x5057484B "PWHK"
    uint32_t count;
    HookProcessRecord records[256];
};
#pragma pack(pop)

extern thread_local uint32_t g_reentry_depth;

struct ReentryGuard {
    bool is_reentrant;
    ReentryGuard() {
        is_reentrant = (++g_reentry_depth > 1);
    }
    ~ReentryGuard() {
        if (g_reentry_depth > 0) {
            --g_reentry_depth;
        }
    }
};

struct HookPolicy {
    bool proxy_tcp;          // 默认 true
    bool block_ipv6;         // 默认 true
    bool block_udp;          // 默认 true
    bool proxy_udp;          // 默认 false
    bool proxy_subprocesses; // 默认 true
    bool bypass_lan;         // 默认 true
    DnsMode dns_mode;        // 默认 SafePure
    PortFilterMode port_filter_mode; // 默认 All
    std::unordered_set<uint16_t> custom_ports;
    TargetFilterMode target_filter_mode; // 默认 All
    std::vector<std::string> target_rules;
};

struct HookConfig {
    uint16_t bundle_port; // 从 PROCWEAVER_BUNDLE_PORT 读取
    uint16_t dns_port;    // 从 PROCWEAVER_DNS_PORT 读取，默认 45053
    bool enabled;
    HookPolicy policy;
};

extern HookConfig g_config;
extern HMODULE g_hModule;
extern HookTier g_hook_tier;

void LoadHookConfig();
void ReportHookTier(HookTier tier);
std::string GetCurrentDllDir();
