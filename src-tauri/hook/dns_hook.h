#pragma once
#include "pw_common.h"

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
