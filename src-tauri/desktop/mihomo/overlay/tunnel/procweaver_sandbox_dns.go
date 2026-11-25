package tunnel

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/metacubex/mihomo/component/fakeip"
	"github.com/metacubex/mihomo/component/resolver"
	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/log"
	D "github.com/miekg/dns"
)

var (
	sandboxDNSGateway = netip.MustParseAddr("198.19.0.1")
	sandboxIP4        = sandboxFakeIP("198.19.0.0/16", 65530)
	sandboxIP6        = sandboxFakeIP("fd00:5057:646e:7300::/96", 65530)
	sandboxDNS        atomic.Pointer[map[string]*SandboxDNS]
	sandboxAliases    = make(map[sandboxAliasKey]sandboxAlias)
	sandboxAliasMutex sync.Mutex
	nextAliasCleanup  time.Time
)

const sandboxAliasTTL = 15 * time.Second

type sandboxAliasKey struct {
	group string
	ip    netip.Addr
}

type sandboxAlias struct {
	host    string
	expires time.Time
}

// SandboxDNS is shared by the normal and WinDivert inlets of one business suite.
type SandboxDNS struct {
	Exit             string
	Group            string
	Resolver         resolver.Resolver
	IPv6             bool
	PreserveTargetIP bool
	Mode             string
	RealIP           bool
	RemoteNames      bool
}

func sandboxFakeIP(prefix string, size int) *fakeip.Pool {
	pool, err := fakeip.New(fakeip.Options{IPNet: netip.MustParsePrefix(prefix), Size: size})
	if err != nil {
		panic(err)
	}
	return pool
}

func SandboxDNSOverlaps(prefix netip.Prefix) bool {
	return prefix.Overlaps(sandboxIP4.IPNet()) || prefix.Overlaps(sandboxIP6.IPNet())
}

func UpdateSandboxDNS(scopes map[string]*SandboxDNS) {
	old := sandboxDNS.Swap(&scopes)
	if old == nil {
		return
	}
	seen := make(map[*SandboxDNS]bool)
	for _, scope := range *old {
		if scope.Resolver != nil && !seen[scope] {
			scope.Resolver.ResetConnection()
			seen[scope] = true
		}
	}
}

func (s *SandboxDNS) protectsDNS() bool {
	return s != nil && s.Resolver != nil
}

func (s *SandboxDNS) needsDialAddress() bool {
	return s.protectsDNS() && (s.Mode != "fake_ip" || !s.RemoteNames)
}

func (s *SandboxDNS) issueAlias(pool *fakeip.Pool, host string) netip.Addr {
	now := time.Now()
	sandboxAliasMutex.Lock()
	defer sandboxAliasMutex.Unlock()
	if !now.Before(nextAliasCleanup) {
		for key, alias := range sandboxAliases {
			if !now.Before(alias.expires) {
				delete(sandboxAliases, key)
			}
		}
		nextAliasCleanup = now.Add(sandboxAliasTTL)
	}
	ip := pool.Lookup(host)
	key := sandboxAliasKey{s.Group, ip}
	if old, ok := sandboxAliases[key]; ok && now.Before(old.expires) {
		if old.host != host {
			return netip.Addr{}
		}
	} else if !ok && len(sandboxAliases) >= 65536 {
		return netip.Addr{}
	}
	sandboxAliases[key] = sandboxAlias{host, now.Add(sandboxAliasTTL)}
	return ip
}

func sandboxDNSFor(metadata *C.Metadata) *SandboxDNS {
	if scopes := sandboxDNS.Load(); scopes != nil {
		return (*scopes)[metadata.SpecialRules]
	}
	return nil
}

func (s *SandboxDNS) usesExit(proxy C.Proxy, metadata *C.Metadata) bool {
	for adapter, depth := C.ProxyAdapter(proxy), 0; adapter != nil && depth < 32; adapter, depth = adapter.Unwrap(metadata, false), depth+1 {
		if adapter.Name() == s.Group {
			return true
		}
	}
	return false
}

func restoreSandboxDNSHost(metadata *C.Metadata) (bool, error) {
	scope := sandboxDNSFor(metadata)
	if metadata.Host != "" || scope == nil {
		return false, nil
	}
	for _, pool := range []*fakeip.Pool{sandboxIP4, sandboxIP6} {
		if !pool.IPNet().Contains(metadata.DstIP) {
			continue
		}
		sandboxAliasMutex.Lock()
		alias, ok := sandboxAliases[sandboxAliasKey{scope.Group, metadata.DstIP}]
		sandboxAliasMutex.Unlock()
		if !ok || !time.Now().Before(alias.expires) {
			return true, fmt.Errorf("sandbox DNS record %s missing", metadata.DstIP)
		}
		metadata.Host = alias.host
		metadata.DstIP = netip.Addr{}
		metadata.DNSMode = C.DNSFakeIP
		return true, nil
	}
	return false, nil
}

func (s *SandboxDNS) resolve(ctx context.Context, host string) (netip.Addr, error) {
	var addresses []netip.Addr
	var err error
	if s.IPv6 {
		addresses, err = s.Resolver.LookupIP(ctx, host)
	} else {
		addresses, err = s.Resolver.LookupIPv4(ctx, host)
	}
	if err != nil {
		return netip.Addr{}, err
	}
	if len(addresses) == 0 {
		return netip.Addr{}, resolver.ErrIPNotFound
	}
	log.Debugln("[Sandbox DNS] %s resolved via %s", host, s.Exit)
	return addresses[0], nil
}

// The helper reaches this DNS-only endpoint through the verified loopback
// SOCKS inlet. Give the browser a scoped alias immediately. Rule evaluation
// comes later, with the original domain AND the real connection metadata.
func serveSandboxDNS(conn net.Conn, scope *SandboxDNS) {
	wire := &D.Conn{Conn: conn}
	for {
		_ = conn.SetDeadline(time.Now().Add(resolver.DefaultDnsRelayTimeout))
		query, err := wire.ReadMsg()
		if err != nil || query.Response || query.Opcode != D.OpcodeQuery || len(query.Question) != 1 {
			return
		}
		if err := wire.WriteMsg(scope.answer(query)); err != nil {
			return
		}
	}
}

func (scope *SandboxDNS) answer(query *D.Msg) *D.Msg {
	q := query.Question[0]
	answer := new(D.Msg).SetReply(query)
	answer.RecursionAvailable = true
	host := strings.ToLower(strings.TrimSuffix(q.Name, "."))
	header := D.RR_Header{Name: q.Name, Rrtype: q.Qtype, Class: q.Qclass, Ttl: uint32(sandboxAliasTTL / time.Second)}
	switch {
	case !scope.protectsDNS() || q.Qclass != D.ClassINET || host == "":
		answer.Rcode = D.RcodeRefused
	case scope.RealIP && (q.Qtype != D.TypeAAAA || scope.IPv6):
		if q.Qtype == D.TypeA || q.Qtype == D.TypeAAAA {
			if node, ok := resolver.DefaultHosts.Search(host, false); ok {
				for _, ip := range node.IPs {
					if q.Qtype == D.TypeA && ip.Is4() {
						answer.Answer = append(answer.Answer, &D.A{Hdr: header, A: ip.AsSlice()})
					} else if q.Qtype == D.TypeAAAA && ip.Is6() {
						answer.Answer = append(answer.Answer, &D.AAAA{Hdr: header, AAAA: ip.AsSlice()})
					}
				}
				break
			}
		}
		answer = scope.exchange(query, answer, host)
	case q.Qtype == D.TypeA:
		if ip := scope.issueAlias(sandboxIP4, host); ip.IsValid() {
			answer.Answer = []D.RR{&D.A{Hdr: header, A: ip.AsSlice()}}
		} else {
			answer.Rcode = D.RcodeServerFailure
		}
	case q.Qtype == D.TypeAAAA && scope.IPv6:
		if ip := scope.issueAlias(sandboxIP6, host); ip.IsValid() {
			answer.Answer = []D.RR{&D.AAAA{Hdr: header, AAAA: ip.AsSlice()}}
		} else {
			answer.Rcode = D.RcodeServerFailure
		}
	case scope.Mode == "fake_ip" || q.Qtype == D.TypeAAAA || q.Qtype == D.TypeHTTPS || q.Qtype == D.TypeSVCB:
		// Real IP hints must not escape the alias mapping or bypass the rule match.
	default:
		answer = scope.exchange(query, answer, host)
	}
	if edns := query.IsEdns0(); edns != nil && answer.IsEdns0() == nil {
		answer.SetEdns0(1232, false)
	}
	return answer
}

func (s *SandboxDNS) exchange(query, answer *D.Msg, host string) *D.Msg {
	ctx, cancel := context.WithTimeout(context.Background(), resolver.DefaultDNSTimeout)
	defer cancel()
	resolved, err := s.Resolver.ExchangeContext(ctx, query)
	if err != nil || resolved == nil {
		answer.Rcode = D.RcodeServerFailure
		return answer
	}
	resolved.Id = query.Id
	log.Debugln("[Sandbox DNS] %s resolved via %s", host, s.Exit)
	return resolved
}
