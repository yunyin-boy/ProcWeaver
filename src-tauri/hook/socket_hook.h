#pragma once
#include "pw_common.h"

typedef int (WSAAPI *PFN_connect)(
    SOCKET s,
    const struct sockaddr *name,
    int namelen
);

typedef int (WSAAPI *PFN_WSAConnect)(
    SOCKET s,
    const struct sockaddr *name,
    int namelen,
    LPWSABUF lpCallerData,
    LPWSABUF lpCalleeData,
    LPQOS lpSQOS,
    LPQOS lpGQOS
);

typedef int (WSAAPI *PFN_sendto)(
    SOCKET s,
    const char *buf,
    int len,
    int flags,
    const struct sockaddr *to,
    int tolen
);

typedef int (WSAAPI *PFN_WSASendTo)(
    SOCKET s,
    LPWSABUF lpBuffers,
    DWORD dwBufferCount,
    LPDWORD lpNumberOfBytesSent,
    DWORD dwFlags,
    const struct sockaddr *lpTo,
    int iTolen,
    LPWSAOVERLAPPED lpOverlapped,
    LPWSAOVERLAPPED_COMPLETION_ROUTINE lpCompletionRoutine
);

extern PFN_connect TrueConnect;
extern PFN_WSAConnect TrueWSAConnect;
extern PFN_sendto TrueSendTo;
extern PFN_WSASendTo TrueWSASendTo;

int WSAAPI HookConnect(
    SOCKET s,
    const struct sockaddr *name,
    int namelen
);

int WSAAPI HookWSAConnect(
    SOCKET s,
    const struct sockaddr *name,
    int namelen,
    LPWSABUF lpCallerData,
    LPWSABUF lpCalleeData,
    LPQOS lpSQOS,
    LPQOS lpGQOS
);

int WSAAPI HookSendTo(
    SOCKET s,
    const char *buf,
    int len,
    int flags,
    const struct sockaddr *to,
    int tolen
);

int WSAAPI HookWSASendTo(
    SOCKET s,
    LPWSABUF lpBuffers,
    DWORD dwBufferCount,
    LPDWORD lpNumberOfBytesSent,
    DWORD dwFlags,
    const struct sockaddr *lpTo,
    int iTolen,
    LPWSAOVERLAPPED lpOverlapped,
    LPWSAOVERLAPPED_COMPLETION_ROUTINE lpCompletionRoutine
);
