import type { BundlePolicy } from "../types/businessBundle";

export function defaultBundlePolicy(): BundlePolicy {
  return {
    proxyTcp: true,
    blockIpv6: true,
    blockUdp: true,
    proxyUdp: false,
    proxySubprocesses: true,
    bypassLan: true,
    dnsMode: "safe_pure",
    portFilterMode: "all",
    customPorts: "",
    targetFilterMode: "all",
    targetRules: [],
    disallowProxyArgs: false,
  };
}

export function normalizeBundlePolicy(policy?: Partial<BundlePolicy> | null): BundlePolicy {
  const defaults = defaultBundlePolicy();
  if (!policy) return defaults;
  return {
    proxyTcp: policy.proxyTcp ?? defaults.proxyTcp,
    blockIpv6: policy.blockIpv6 ?? defaults.blockIpv6,
    blockUdp: policy.blockUdp ?? defaults.blockUdp,
    proxyUdp: policy.proxyUdp ?? defaults.proxyUdp,
    proxySubprocesses: policy.proxySubprocesses ?? defaults.proxySubprocesses,
    bypassLan: policy.bypassLan ?? defaults.bypassLan,
    dnsMode: policy.dnsMode ?? defaults.dnsMode,
    portFilterMode: policy.portFilterMode ?? defaults.portFilterMode,
    customPorts: policy.customPorts ?? defaults.customPorts,
    targetFilterMode: policy.targetFilterMode ?? defaults.targetFilterMode,
    targetRules: Array.isArray(policy.targetRules) ? policy.targetRules : defaults.targetRules,
    disallowProxyArgs: policy.disallowProxyArgs ?? defaults.disallowProxyArgs,
  };
}
