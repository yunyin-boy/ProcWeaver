#pragma once
#include "pw_common.h"
#include <windns.h>
#pragma comment(lib, "dnsapi.lib")

typedef int (WSAAPI *PFN_getaddrinfo)(
    PCSTR pNodeName,
    PCSTR pServiceName,
    const ADDRINFOA *pHints,
    PADDRINFOA *ppResult
);

typedef int (WSAAPI *PFN_GetAddrInfoW)(
    PCWSTR pNodeName,
    PCWSTR pServiceName,
    const ADDRINFOW *pHints,
    PADDRINFOW *ppResult
);

typedef void (WSAAPI *PFN_freeaddrinfo)(
    PADDRINFOA pAddrInfo
);

typedef void (WSAAPI *PFN_FreeAddrInfoW)(
    PADDRINFOW pAddrInfo
);

extern PFN_getaddrinfo TrueGetAddrInfo;
extern PFN_GetAddrInfoW TrueGetAddrInfoW;
extern PFN_freeaddrinfo TrueFreeAddrInfo;
extern PFN_FreeAddrInfoW TrueFreeAddrInfoW;

int WSAAPI HookGetAddrInfo(
    PCSTR pNodeName,
    PCSTR pServiceName,
    const ADDRINFOA *pHints,
    PADDRINFOA *ppResult
);

int WSAAPI HookGetAddrInfoW(
    PCWSTR pNodeName,
    PCWSTR pServiceName,
    const ADDRINFOW *pHints,
    PADDRINFOW *ppResult
);

void WSAAPI HookFreeAddrInfo(
    PADDRINFOA pAddrInfo
);

void WSAAPI HookFreeAddrInfoW(
    PADDRINFOW pAddrInfo
);

// Fake-IP 管理接口
std::string GetDomainForFakeIp(uint32_t ip);
uint32_t AllocateFakeIpForDomain(const std::string& domain);
bool IsFakeIp(uint32_t ip);

extern decltype(&gethostbyname) TrueGetHostByName;
extern decltype(&GetAddrInfoExA) TrueGetAddrInfoExA;
extern decltype(&GetAddrInfoExW) TrueGetAddrInfoExW;
extern decltype(&FreeAddrInfoExA) TrueFreeAddrInfoExA;
extern decltype(&FreeAddrInfoExW) TrueFreeAddrInfoExW;
hostent* WSAAPI HookGetHostByName(const char* name);
int WSAAPI HookGetAddrInfoExA(PCSTR name, PCSTR service, DWORD space, LPGUID provider,
    const ADDRINFOEXA* hints, PADDRINFOEXA* result, timeval* timeout, LPOVERLAPPED overlap,
    LPLOOKUPSERVICE_COMPLETION_ROUTINE completion, LPHANDLE handle);
int WSAAPI HookGetAddrInfoExW(PCWSTR name, PCWSTR service, DWORD space, LPGUID provider,
    const ADDRINFOEXW* hints, PADDRINFOEXW* result, timeval* timeout, LPOVERLAPPED overlap,
    LPLOOKUPSERVICE_COMPLETION_ROUTINE completion, LPHANDLE handle);
void WSAAPI HookFreeAddrInfoExA(PADDRINFOEXA result);
void WSAAPI HookFreeAddrInfoExW(PADDRINFOEXW result);

extern decltype(&DnsQuery_A) TrueDnsQueryA;
extern decltype(&DnsQuery_W) TrueDnsQueryW;
extern decltype(&DnsQuery_UTF8) TrueDnsQueryUtf8;
extern decltype(&DnsQueryEx) TrueDnsQueryEx;
DNS_STATUS WINAPI HookDnsQueryA(PCSTR name, WORD type, DWORD options, PVOID extra, PDNS_RECORDA* result, PVOID* reserved);
DNS_STATUS WINAPI HookDnsQueryW(PCWSTR name, WORD type, DWORD options, PVOID extra, PDNS_RECORD* result, PVOID* reserved);
DNS_STATUS WINAPI HookDnsQueryUtf8(PCSTR name, WORD type, DWORD options, PVOID extra, PDNS_RECORDA* result, PVOID* reserved);
DNS_STATUS WINAPI HookDnsQueryEx(PDNS_QUERY_REQUEST request, PDNS_QUERY_RESULT result, PDNS_QUERY_CANCEL cancel);
