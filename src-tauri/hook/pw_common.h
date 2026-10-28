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

void LoadHookConfig();
std::string GetCurrentDllDir();
