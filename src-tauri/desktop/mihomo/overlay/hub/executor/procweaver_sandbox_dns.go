package executor

import (
	"context"
	"fmt"

	"github.com/metacubex/mihomo/config"
	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/dns"
	"github.com/metacubex/mihomo/tunnel"
)

// Dial the selected leaf so a group change cannot turn a checked DoH request
// into a direct or local DNS connection between selection and dialing.
type sandboxDNSProxy struct{ C.Proxy }

func (p sandboxDNSProxy) SupportUDP() bool { return false }

func (p sandboxDNSProxy) DialContext(ctx context.Context, metadata *C.Metadata) (C.Conn, error) {
	leaf := p.Proxy
	for depth := 0; depth < 32; depth++ {
		if next := leaf.Unwrap(metadata, true); next != nil {
			leaf = next
			continue
		}
		switch leaf.Type() {
		case C.Direct, C.Compatible, C.Reject, C.RejectDrop, C.Pass, C.PassRule, C.Rematch, C.Dns,
			C.Relay, C.Selector, C.Fallback, C.URLTest, C.LoadBalance:
			return nil, fmt.Errorf("sandbox DNS outlet %s has no selected proxy", p.Name())
		default:
			return leaf.DialContext(ctx, metadata)
		}
	}
	return nil, fmt.Errorf("sandbox DNS outlet %s has a proxy-group cycle", p.Name())
}

func updateSandboxDNS(cfg *config.Config) {
	scopes := make(map[string]*tunnel.SandboxDNS)
	for _, spec := range cfg.ProcWeaverSandboxDNS {
		ipv6 := spec.IPv6 && cfg.General.IPv6
		exit := cfg.Proxies[spec.Exit]
		scope := &tunnel.SandboxDNS{
			Exit: spec.Exit, Group: spec.Group, IPv6: ipv6, Mode: spec.Mode,
			RealIP: spec.RealIP, PreserveTargetIP: spec.PreserveTargetIP,
		}
		switch exit.Type() {
		case C.Socks5, C.Http, C.Shadowsocks, C.ShadowsocksR, C.Vmess, C.Vless,
			C.Trojan, C.Hysteria, C.Hysteria2, C.Tuic, C.AnyTLS:
			scope.RemoteNames = true
		}
		if spec.Mode != "system_native" {
			upstream := dns.NewResolver(dns.Config{
				Main: []dns.NameServer{{
					Net: "https", Addr: "https://1.1.1.1/dns-query",
					ProxyAdapter: sandboxDNSProxy{exit},
				}},
				IPv6: ipv6,
			})
			scope.Resolver = upstream.Resolver
		}
		for _, rule := range spec.Rules {
			scopes[rule] = scope
		}
	}
	tunnel.UpdateSandboxDNS(scopes)
}
