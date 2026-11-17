package auth

import (
	"net/http"
	"testing"
	"time"
)

func req(remote string, h map[string]string) *http.Request {
	r, _ := http.NewRequest("GET", "http://x/", nil)
	r.RemoteAddr = remote
	for k, v := range h {
		r.Header.Set(k, v)
	}
	return r
}

func TestClientIP(t *testing.T) {
	private, _ := ParseProxies("private")
	none, _ := ParseProxies("none")
	one, err := ParseProxies("172.20.0.5, 10.1.0.0/16")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseProxies("nope"); err == nil {
		t.Fatal("bad proxy list accepted")
	}
	for _, c := range []struct {
		name    string
		r       *http.Request
		trusted []string
		want    string
	}{
		{"direct, forged header", req("203.0.113.9:1", map[string]string{"X-Real-IP": "1.2.3.4", "X-Forwarded-For": "1.2.3.4"}), nil, "203.0.113.9"},
		{"behind the proxy", req("172.20.0.5:1", map[string]string{"X-Forwarded-For": "6.6.6.6, 198.51.100.7"}), nil, "198.51.100.7"},
		{"client-supplied entry is skipped", req("172.20.0.5:1", map[string]string{"X-Forwarded-For": "10.0.0.1, 198.51.100.7, 172.20.0.2"}), nil, "198.51.100.7"},
		{"cloudflare", req("172.20.0.5:1", map[string]string{"CF-Connecting-IP": "198.51.100.8", "X-Forwarded-For": "1.1.1.1"}), nil, "198.51.100.8"},
		{"no headers", req("192.168.1.4:1", nil), nil, "192.168.1.4"},
	} {
		if got := ClientIP(c.r, private); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
	if got := ClientIP(req("172.20.0.5:1", map[string]string{"X-Real-IP": "9.9.9.9"}), none); got != "172.20.0.5" {
		t.Errorf("no proxy trusted: %s", got)
	}
	if got := ClientIP(req("172.20.0.5:1", map[string]string{"X-Real-IP": "9.9.9.9"}), one); got != "9.9.9.9" {
		t.Errorf("listed proxy: %s", got)
	}
	if got := ClientIP(req("172.20.0.6:1", map[string]string{"X-Real-IP": "9.9.9.9"}), one); got != "172.20.0.6" {
		t.Errorf("unlisted proxy: %s", got)
	}
}

func TestTOTP(t *testing.T) {
	// RFC 6238 test secret "12345678901234567890"
	key, err := ParseTOTPSecret("gezd gnbv-gy3t qojq GEZD GNBV GY3T QOJQ")
	if err != nil {
		t.Fatal(err)
	}
	if got := totpCode(key, 59/30); got != "287082" {
		t.Fatalf("RFC 6238 vector: %s", got)
	}
	if _, err := ParseTOTPSecret("short"); err == nil {
		t.Fatal("short secret accepted")
	}
	a := New(Options{User: "me", Password: "pw", Secret: "0123456789abcdef0123456789abcdef", TOTPSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", BanAfter: 5})
	now := time.Unix(1_700_000_000, 0)
	a.now = func() time.Time { return now }
	acc := a.Check("me", "pw")
	good := totpCode(key, uint64(now.Unix()/30))
	if a.checkCode(acc, "000000") || a.checkCode(acc, "") {
		t.Fatal("wrong code accepted")
	}
	if !a.checkCode(acc, good) {
		t.Fatal("right code refused")
	}
	if a.checkCode(acc, good) {
		t.Fatal("a code worked twice")
	}
	if !a.checkCode(acc, totpCode(key, uint64(now.Unix()/30)+1)) {
		t.Fatal("next step (clock drift) refused")
	}
	secret, link := NewTOTPSecret("me")
	if _, err := ParseTOTPSecret(secret); err != nil || link == "" {
		t.Fatalf("new secret: %v", err)
	}
}
