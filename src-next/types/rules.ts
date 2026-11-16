// ==========================================================================
// ProcWeaver src-next 业务规则编织系统类型定义 (Rules Types)
// 规范溯源: typography-dark-mono-optics / tauri-desktop-layout-typography
// ==========================================================================

export type RuleType =
  | "DOMAIN"
  | "DOMAIN-SUFFIX"
  | "DOMAIN-KEYWORD"
  | "IP-CIDR"
  | "IP-CIDR6"
  | "GEOSITE"
  | "GEOIP"
  | "PROCESS-NAME"
  | "PROCESS-PATH"
  | "MATCH"
  | string;

export interface RuleItem {
  id: string;
  type: RuleType;
  payload: string;
  proxy: string;
  size?: number;
  format?: string;
}

export interface RuleProviderItem {
  name: string;
  type: string;        // "Rule" | "Domain" | "IPCIDR"
  vehicleType: string; // "HTTP" | "File"
  behavior: "domain" | "ipcidr" | "classical" | string;
  format: "yaml" | "mrs" | "text" | string;
  ruleCount: number;
  updatedAt?: string;
  url?: string;
  isUpdating?: boolean;
}

export interface RouteSimulateResult {
  input: string;
  matched: boolean;
  rule?: RuleItem;
  ruleIndex?: number;
  targetProxy?: string;
  matchType?: string;
  matchDetail?: string;
}

export type RulesSubTab = "active" | "providers" | "simulator";
