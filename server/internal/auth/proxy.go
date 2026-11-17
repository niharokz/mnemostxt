package auth

// Which address a request really comes from. Forwarding headers
// (CF-Connecting-IP, X-Real-IP, X-Forwarded-For) are believed only when the
// connection itself comes from a trusted proxy (MNEMOSTXT_TRUSTED_PROXIES);
// anyone else could write them and dodge the sign-in limit.

import (
	"fmt"
	"net"
	"net/http"
	"strings"
)

var privateNets = mustNets("127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10", "::1/128", "fc00::/7", "fe80::/10")

func mustNets(cidrs ...string) []*net.IPNet {
	var out []*net.IPNet
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			panic(err)
		}
		out = append(out, n)
	}
	return out
}

// ParseProxies reads MNEMOSTXT_TRUSTED_PROXIES: "private" (the default: LAN,
// Docker, loopback and Tailscale ranges), "none", or addresses and CIDR
// ranges separated by commas.
func ParseProxies(s string) ([]*net.IPNet, error) {
	var out []*net.IPNet
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		switch {
		case part == "" || strings.EqualFold(part, "none"):
		case strings.EqualFold(part, "private"):
			out = append(out, privateNets...)
		case strings.Contains(part, "/"):
			_, n, err := net.ParseCIDR(part)
			if err != nil {
				return nil, fmt.Errorf("%q is not an address range", part)
			}
			out = append(out, n)
		default:
			ip := net.ParseIP(part)
			if ip == nil {
				return nil, fmt.Errorf("%q is not an address", part)
			}
			bits := 128
			if ip.To4() != nil {
				bits = 32
			}
			out = append(out, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
		}
	}
	return out, nil
}

func inNets(ip string, nets []*net.IPNet) bool {
	p := net.ParseIP(ip)
	if p == nil {
		return false
	}
	for _, n := range nets {
		if n.Contains(p) {
			return true
		}
	}
	return false
}

// ClientIP is the address to count failed sign-ins against.
func ClientIP(r *http.Request, trusted []*net.IPNet) string {
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remote = r.RemoteAddr
	}
	if !inNets(remote, trusted) {
		return remote // not our proxy: its headers prove nothing
	}
	for _, h := range []string{"CF-Connecting-IP", "X-Real-IP"} {
		if v := strings.TrimSpace(r.Header.Get(h)); v != "" && net.ParseIP(v) != nil {
			return v
		}
	}
	// X-Forwarded-For: the right-most entry that is not one of our proxies
	var hops []string
	for _, line := range r.Header.Values("X-Forwarded-For") {
		for _, p := range strings.Split(line, ",") {
			if p = strings.TrimSpace(p); net.ParseIP(p) != nil {
				hops = append(hops, p)
			}
		}
	}
	for i := len(hops) - 1; i >= 0; i-- {
		if !inNets(hops[i], trusted) {
			return hops[i]
		}
	}
	if len(hops) > 0 {
		return hops[0]
	}
	return remote
}

// Secure reports HTTPS: directly, or as told by a trusted proxy.
func (a *Auth) Secure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remote = r.RemoteAddr
	}
	return inNets(remote, a.opt.TrustedProxies) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}
