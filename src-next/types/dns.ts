// ==========================================================================
// ProcWeaver src-next DNS 智能护航与本地解析引擎模型
// 映射自后端 DnsSettings (src-tauri/src/commands/dns.rs)
// ==========================================================================

export type DnsEnhancedMode = "fake-ip" | "redir-host" | "normal" | "hosts";
export type DnsListenerMode = "auto" | "fixed" | "off";

export interface DnsGuardInfo {
  enabled: boolean;
  fakeIpCount?: number;
  hijackedDomains?: number;
}

export interface DnsListenerStatus {
  listen: string;
  running: boolean;
  resolverEnabled?: boolean;
}

export interface DnsSettings {
  enableOverride: boolean;
  status: boolean;
  listen: string;
  listenerMode?: DnsListenerMode | null;
  enhancedMode: DnsEnhancedMode;
  fakeIpRange: string;
  fakeIpFilter: string[];
  useHosts: boolean;
  useSystemHosts: boolean;
  respectRules: boolean;
  preferH3: boolean;
  ipv6: boolean;
  defaultNameserver: string[];
  nameserver: string[];
  fallback: string[];
  proxyServerNameserver: string[];
  appendSystemDns?: boolean;
  nameserverPolicy?: Record<string, string>;
  fallbackFilterGeoip: boolean;
  fallbackFilterGeoipCode: string;
  fallbackFilterGeosite?: string[];
  fallbackFilterIpcidr?: string[];
  fallbackFilterDomain?: string[];
}

export const DEFAULT_DNS_SETTINGS: DnsSettings = {
  enableOverride: false,
  status: true,
  listen: "0.0.0.0:1053",
  enhancedMode: "fake-ip",
  fakeIpRange: "198.18.0.1/16",
  fakeIpFilter: [
    "*.lan",
    "*.local",
    "*.home.arpa",
    "+.msftconnecttest.com",
    "+.msftncsi.com",
    "*.msftncsi.com",
    "time.windows.com",
    "time.nist.gov",
    "pool.ntp.org",
    "+.pool.ntp.org",
    "localhost.ptlogin2.qq.com",
    "+.market.xiaomi.com",
  ],
  useHosts: true,
  useSystemHosts: true,
  respectRules: false,
  preferH3: false,
  ipv6: false,
  appendSystemDns: false,
  nameserverPolicy: {},
  defaultNameserver: ["223.5.5.5", "119.29.29.29"],
  nameserver: [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query",
  ],
  fallback: [
    "https://1.1.1.1/dns-query",
    "https://8.8.8.8/dns-query",
  ],
  proxyServerNameserver: ["223.5.5.5", "119.29.29.29"],
  fallbackFilterGeoip: true,
  fallbackFilterGeoipCode: "CN",
  fallbackFilterGeosite: ["gfw"],
  fallbackFilterIpcidr: ["240.0.0.0/4"],
  fallbackFilterDomain: [],
};
