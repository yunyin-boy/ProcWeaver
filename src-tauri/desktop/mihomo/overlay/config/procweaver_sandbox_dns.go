package config

import (
	"fmt"
	"strings"

	C "github.com/metacubex/mihomo/constant"
	T "github.com/metacubex/mihomo/tunnel"
)

type SandboxDNS struct {
	Exit             string   `yaml:"exit" json:"exit"`
	Group            string   `yaml:"group" json:"group"`
	Rules            []string `yaml:"rules" json:"rules"`
	IPv6             bool     `yaml:"ipv6" json:"ipv6"`
	PreserveTargetIP bool     `yaml:"preserve_target_ip" json:"preserve_target_ip"`
	Mode             string   `yaml:"mode" json:"mode"`
	RealIP           bool     `yaml:"real_ip" json:"real_ip"`
}

func parseSandboxDNS(raw *RawConfig, cfg *Config) error {
	if len(raw.ProcWeaverSandboxDNS) == 0 {
		return nil
	}
	if cfg.DNS.EnhancedMode == C.DNSFakeIP && (T.SandboxDNSOverlaps(cfg.DNS.FakeIPRange) || T.SandboxDNSOverlaps(cfg.DNS.FakeIPRange6)) {
		return fmt.Errorf("DNS fake-ip range overlaps the ProcWeaver sandbox")
	}
	loopbackRules := make(map[string]bool)
	for _, listener := range raw.Listeners {
		if listener["listen"] == "127.0.0.1" && (listener["type"] == "mixed" || listener["type"] == "socks") {
			if rule, ok := listener["rule"].(string); ok {
				loopbackRules[rule] = true
			}
		}
	}
	seen := make(map[string]bool)
	for _, spec := range raw.ProcWeaverSandboxDNS {
		switch spec.Mode {
		case "", "safe_pure", "fake_ip", "system_native":
		default:
			return fmt.Errorf("invalid ProcWeaver suite DNS mode")
		}
		if spec.RealIP && spec.Mode != "safe_pure" {
			return fmt.Errorf("real DNS answers require safe_pure mode")
		}
		exit := cfg.Proxies[spec.Exit]
		if exit == nil || cfg.Proxies[spec.Group] == nil || !strings.HasPrefix(spec.Group, "PW-") || len(spec.Rules) == 0 {
			return fmt.Errorf("invalid ProcWeaver sandbox DNS outlet")
		}
		switch exit.Type() {
		case C.Direct, C.Compatible, C.Reject, C.RejectDrop, C.Pass, C.Dns:
			return fmt.Errorf("invalid ProcWeaver sandbox DNS proxy type")
		}
		for _, rule := range spec.Rules {
			if !loopbackRules[rule] || seen[rule] || len(cfg.SubRules[rule]) == 0 {
				return fmt.Errorf("invalid ProcWeaver sandbox DNS inlet")
			}
			seen[rule] = true
		}
	}
	cfg.ProcWeaverSandboxDNS = raw.ProcWeaverSandboxDNS
	return nil
}
