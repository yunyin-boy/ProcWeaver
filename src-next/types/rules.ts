// ==========================================================================
// ProcWeaver src-next 业务规则编织系统类型定义 (Rules Types)
// 规范溯源: typography-dark-mono-optics / tauri-desktop-layout-typography
// ==========================================================================

import type { RoutingTarget } from "../../src/types/routingOverrides";

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
  hitCount?: number;
  disabled?: boolean;
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
  managed?: boolean;
  loaded?: boolean;
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

export interface CustomRuleCondition {
  kind: string;
  value: string;
  options: string[];
}

export type CustomRuleAction =
  | { kind: "direct" }
  | { kind: "reject" }
  | { kind: "outlet"; target: RoutingTarget };

export interface CustomRule {
  id: string;
  profileId: string | null;
  enabled: boolean;
  condition: CustomRuleCondition;
  action: CustomRuleAction;
}

export interface SourceRule {
  order: number;
  expression: string;
  copy: { condition: CustomRuleCondition; action: CustomRuleAction | null } | null;
}

export interface RuleWorkbenchState {
  revision: number;
  profileId: string;
  profileName: string;
  sourceLabel: string;
  running: boolean;
  outlets: { label: string; target: RoutingTarget }[];
  sourceRules: SourceRule[];
  rules: (CustomRule & { availability: "ready" | "missing_outlet" | "missing_rule_set" })[];
}
