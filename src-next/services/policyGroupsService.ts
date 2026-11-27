import { invokeCommand, isTauriEnvironment } from "./client";
import { getSpeedtestUrl } from "./proxyService";

export const POLICY_CHECK_INTERVALS = [2, 5, 15, 30] as const;
export type PolicyCheckInterval = typeof POLICY_CHECK_INTERVALS[number];

export interface PolicyGroupConditions {
  regions: string[];
  keywords: string[];
  protocols: string[];
  maxMultiplier: number | null;
  maxDelayMs: number | null;
  checkIntervalMinutes: PolicyCheckInterval;
}

export interface PolicyGroupProbe {
  name: string;
  status: "passed" | "expired" | "timeout" | "failed" | "unavailable";
  delayMs: number | null;
  expiresAt: number;
}

export interface PolicyGroup {
  name: string;
  strategy: "select" | "url-test";
  members: string[];
  parents: string[];
  automatic?: PolicyGroupConditions;
}

export interface PolicyGroupRow extends PolicyGroup {
  missingMembers: string[];
  missingParents: string[];
  automaticMembers: string[];
  checkStatus: PolicyCheckStatus | null;
}

interface PolicyMemberChange {
  name: string;
  reason: string;
}

export interface PolicyCheckStatus {
  checking: boolean;
  nextAt: number | null;
  last: {
    checkedAt: number;
    added: PolicyMemberChange[];
    removed: PolicyMemberChange[];
    incomplete: number;
  } | null;
  error: string | null;
}

export interface PolicyGroupEntry {
  name: string;
  label: string;
  kind: "node" | "select" | "url-test" | "group" | "action";
  node?: { region: string; regionName: string; protocol: string; multiplier: number };
}

export interface PolicyGroupWorkbench {
  profileId: string;
  profileName: string;
  primarySelector: string | null;
  revision: number;
  running: boolean;
  groups: PolicyGroupRow[];
  entries: PolicyGroupEntry[];
  testUrl: string;
  probes: PolicyGroupProbe[];
}

export type PolicyGroupChange =
  | { kind: "create" | "update"; group: PolicyGroup }
  | { kind: "delete"; name: string };

export function fetchPolicyGroups(): Promise<PolicyGroupWorkbench | null> {
  if (!isTauriEnvironment()) return Promise.resolve(null);
  return invokeCommand<PolicyGroupWorkbench>("get_policy_groups", { testUrl: getSpeedtestUrl() });
}

export function savePolicyGroup(
  context: PolicyGroupWorkbench, change: PolicyGroupChange,
): Promise<PolicyGroupWorkbench> {
  const { profileId, revision, testUrl } = context;
  return invokeCommand<PolicyGroupWorkbench>("save_policy_group", { request: { profileId, revision, change, testUrl } });
}

export function measurePolicyGroupNodes(context: PolicyGroupWorkbench, names: string[]): Promise<PolicyGroupProbe[]> {
  const { profileId, testUrl } = context;
  return invokeCommand<PolicyGroupProbe[]>("test_policy_group_nodes", { profileId, testUrl, names });
}

export function checkPolicyGroupNow(profileId: string, name: string): Promise<void> {
  return invokeCommand<void>("check_policy_group_now", { profileId, name });
}

export function isManualGroup(type: string) {
  return ["select", "selector"].includes(type.toLowerCase());
}
