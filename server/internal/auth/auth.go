// Package auth signs people in, with signed session cookies, a sliding-window
// limit on failed sign-ins and bans that survive restarts.
//
//   - Two accounts at most: the owner (MNEMOSTXT_USER) and, optionally, a demo
//     account (MNEMOSTXT_DEMO_USER) that sees a read-only sample folder. The demo
//     credentials are shown on the sign-in card, nowhere else.
//   - A password may be plain text or a bcrypt hash (`mnemostxt hash-password`);
//     comparisons take constant time, and an unknown user costs as long as a
//     wrong password.
//   - The session cookie is user|expiry|HMAC-SHA256. Each account's key comes
//     from MNEMOSTXT_SECRET *and* its password, so changing either signs that
//     account out everywhere.
//   - Over HTTPS the cookie is "__Host-mnemostxt" (Secure, Path=/, no Domain);
//     always HttpOnly and SameSite=Strict.
//   - Optional second step for the owner: a 6-digit authenticator code
//     (MNEMOSTXT_TOTP_SECRET, totp.go).
//   - BanAfter failures within 15 minutes ban the address for BanHours (saved in
//     the state folder). LAN and Tailscale addresses are only slowed down unless
//     BanPrivate is set, so you cannot lock yourself out at home.
//   - The client address comes from CF-Connecting-IP, X-Real-IP or
//     X-Forwarded-For only when the connection is from a trusted proxy
//     (MNEMOSTXT_TRUSTED_PROXIES, proxy.go); otherwise it is the peer itself.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"gitlab.com/niharokz/mnemostxt/server/internal/httpx"
)

const (
	CookieName       = "mnemostxt_session"
	SecureCookieName = "__Host-mnemostxt"
	SessionTTL       = 30 * 24 * time.Hour
	FailWindow       = 15 * time.Minute
	maxTracked       = 10000
)

type Options struct {
	User, Password         string // the owner
	DemoUser, DemoPassword string // optional read-only demo account
	Secret                 string
	BanAfter               int
	BanFor                 time.Duration
	BanPrivate             bool
	StateDir               string // bans.json lives here; "" = in memory only
	TOTPSecret             string // base32; "" = no second step
	TrustedProxies         []*net.IPNet
}

// Account is someone who can sign in.
type Account struct {
	User     string
	Demo     bool
	password string
	key      []byte
}

type Auth struct {
	accounts []*Account
	dummy    string
	opt      Options
	now      func() time.Time

	totp []byte // the owner's authenticator key, nil when off

	mu       sync.Mutex
	fails    map[string][]time.Time
	bans     map[string]time.Time
	totpLast uint64 // the last time step a code was accepted for
}

func New(o Options) *Auth {
	secret := o.Secret
	if secret == "" {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		secret = hex.EncodeToString(b)
		log.Printf("auth: MNEMOSTXT_SECRET is empty — sessions end when the server restarts")
	} else if len(secret) < 32 {
		log.Printf("auth: MNEMOSTXT_SECRET is short (%d characters) — use at least 32: openssl rand -hex 32", len(secret))
	}
	if o.Password != "" && !IsHash(o.Password) {
		log.Printf("auth: the password is stored as plain text — prefer MNEMOSTXT_PASSWORD_HASH (mnemostxt hash-password)")
	}
	a := &Auth{opt: o, now: time.Now, fails: map[string][]time.Time{}, bans: map[string]time.Time{}}
	add := func(user, pw string, demo bool) {
		user = strings.ToLower(strings.TrimSpace(user))
		if user == "" || pw == "" {
			return
		}
		k := sha256.Sum256([]byte("mnemostxt-session\x00" + secret + "\x00" + user + "\x00" + pw))
		a.accounts = append(a.accounts, &Account{User: user, Demo: demo, password: pw, key: k[:]})
	}
	add(o.User, o.Password, false)
	add(o.DemoUser, o.DemoPassword, true)
	a.dummy = secret
	if IsHash(o.Password) {
		a.dummy = o.Password
	}
	if o.TOTPSecret != "" {
		if key, err := ParseTOTPSecret(o.TOTPSecret); err == nil {
			a.totp = key
		} else {
			log.Printf("auth: MNEMOSTXT_TOTP_SECRET ignored: %v", err)
		}
	}
	a.loadBans()
	return a
}

// TOTP reports whether the owner signs in with an authenticator code too.
func (a *Auth) TOTP() bool { return a.totp != nil }

// checkCode accepts a current code once (the owner only; the demo has none).
func (a *Auth) checkCode(acc *Account, code string) bool {
	if a.totp == nil || acc.Demo {
		return true
	}
	c := totpCounter(a.totp, code, a.now())
	a.mu.Lock()
	defer a.mu.Unlock()
	if c == 0 || c <= a.totpLast {
		return false
	}
	a.totpLast = c
	return true
}

func HashPassword(pw string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	return string(h), err
}

func IsHash(s string) bool {
	return strings.HasPrefix(s, "$2a$") || strings.HasPrefix(s, "$2b$") || strings.HasPrefix(s, "$2y$")
}

func checkPassword(stored, given string) bool {
	if IsHash(stored) {
		return bcrypt.CompareHashAndPassword([]byte(stored), []byte(given)) == nil
	}
	return subtle.ConstantTimeCompare([]byte(stored), []byte(given)) == 1
}

func (a *Auth) account(user string) *Account {
	user = strings.ToLower(strings.TrimSpace(user))
	for _, acc := range a.accounts {
		if acc.User == user {
			return acc
		}
	}
	return nil
}

// Check returns the account when user and password are right.
func (a *Auth) Check(user, pw string) *Account {
	acc := a.account(user)
	if acc == nil {
		checkPassword(a.dummy, pw)
		return nil
	}
	if !checkPassword(acc.password, pw) {
		return nil
	}
	return acc
}

func sign(key []byte, p string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(p))
	return hex.EncodeToString(m.Sum(nil))
}

func (a *Auth) Token(acc *Account, exp time.Time) string {
	p := acc.User + "|" + strconv.FormatInt(exp.Unix(), 10)
	return base64.RawURLEncoding.EncodeToString([]byte(p + "|" + sign(acc.key, p)))
}

// Valid returns the account a session token belongs to, or nil.
func (a *Auth) Valid(tok string) *Account {
	raw, err := base64.RawURLEncoding.DecodeString(tok)
	if err != nil {
		return nil
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 3 {
		return nil
	}
	acc := a.account(parts[0])
	if acc == nil || !hmac.Equal([]byte(sign(acc.key, parts[0]+"|"+parts[1])), []byte(parts[2])) {
		return nil
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || a.now().Unix() > exp {
		return nil
	}
	return acc
}

// Who returns the signed-in account of a request, or nil.
func (a *Auth) Who(r *http.Request) *Account {
	for _, n := range []string{SecureCookieName, CookieName} {
		if c, err := r.Cookie(n); err == nil {
			if acc := a.Valid(c.Value); acc != nil {
				return acc
			}
		}
	}
	return nil
}

// Signed reports whether the request carries a valid session.
func (a *Auth) Signed(r *http.Request) bool { return a.Who(r) != nil }

// IsDemo reports whether the request comes from the demo account.
func (a *Auth) IsDemo(r *http.Request) bool {
	acc := a.Who(r)
	return acc != nil && acc.Demo
}

// demoCard is what the sign-in card shows: the demo account, only when its
// password is plain text (a hash cannot be shown).
func (a *Auth) demoCard() map[string]string {
	for _, acc := range a.accounts {
		if acc.Demo && !IsHash(acc.password) {
			return map[string]string{"user": acc.User, "password": acc.password}
		}
	}
	return nil
}

func (a *Auth) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/login", a.login)
	mux.HandleFunc("POST /api/logout", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(httpx.Header) == "" || !httpx.SameOrigin(r) {
			httpx.Fail(w, http.StatusForbidden, "DENIED", "cross-site request refused")
			return
		}
		for _, n := range []string{SecureCookieName, CookieName} {
			http.SetCookie(w, &http.Cookie{Name: n, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: n == SecureCookieName || a.Secure(r)})
		}
		httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/me", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if acc := a.Who(r); acc != nil {
			httpx.JSON(w, http.StatusOK, map[string]any{"signed_in": true, "user": acc.User, "is_demo": acc.Demo})
			return
		}
		out := map[string]any{"signed_in": false, "totp": a.TOTP()}
		if d := a.demoCard(); d != nil {
			out["demo"] = d
		}
		httpx.JSON(w, http.StatusOK, out)
	})
}

func (a *Auth) login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Header.Get(httpx.Header) == "" || !httpx.SameOrigin(r) {
		httpx.Fail(w, http.StatusForbidden, "DENIED", "cross-site request refused")
		return
	}
	ip := ClientIP(r, a.opt.TrustedProxies)
	if until, banned := a.banned(ip); banned {
		httpx.Fail(w, http.StatusTooManyRequests, "DENIED", "too many failed sign-ins — blocked until "+until.Format("2 Jan 15:04"))
		return
	}
	var in struct{ User, Password, Code string }
	if err := httpx.Decode(w, r, 16<<10, &in); err != nil {
		httpx.Fail(w, http.StatusBadRequest, "INVALID", "invalid request")
		return
	}
	acc := a.Check(in.User, in.Password)
	if acc != nil && !a.checkCode(acc, in.Code) {
		acc = nil // same answer as a wrong password: no hint which part failed
	}
	if acc == nil {
		n := a.fail(ip)
		log.Printf("login: failed sign-in from %s (%d of %d)", ip, n, a.opt.BanAfter)
		time.Sleep(time.Duration(300+100*min(n, 20)) * time.Millisecond)
		msg := "wrong user name or password"
		if a.TOTP() {
			msg = "wrong user name, password or code"
		}
		httpx.Fail(w, http.StatusUnauthorized, "AUTH", msg)
		return
	}
	a.reset(ip)
	log.Printf("login: %s signed in from %s", acc.User, ip)
	secure := a.Secure(r)
	name := CookieName
	if secure {
		name = SecureCookieName
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: a.Token(acc, a.now().Add(SessionTTL)), Path: "/", MaxAge: int(SessionTTL.Seconds()), HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: secure})
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "user": acc.User})
}

// private: LAN, loopback and Tailscale (100.64.0.0/10) addresses.
func private(ip string) bool {
	return inNets(ip, privateNets)
}

func (a *Auth) banned(ip string) (time.Time, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	until, ok := a.bans[ip]
	if ok && a.now().Before(until) {
		return until, true
	}
	if ok {
		delete(a.bans, ip)
	}
	// a locked window also blocks, briefly, even for private addresses
	if len(a.prune(ip)) >= a.opt.BanAfter {
		return a.fails[ip][0].Add(FailWindow), true
	}
	return time.Time{}, false
}

func (a *Auth) prune(ip string) []time.Time {
	var keep []time.Time
	for _, t := range a.fails[ip] {
		if a.now().Sub(t) < FailWindow {
			keep = append(keep, t)
		}
	}
	if len(keep) == 0 {
		delete(a.fails, ip)
	} else {
		a.fails[ip] = keep
	}
	return keep
}

func (a *Auth) fail(ip string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.fails) >= maxTracked {
		a.fails = map[string][]time.Time{}
	}
	a.fails[ip] = append(a.prune(ip), a.now())
	n := len(a.fails[ip])
	if n >= a.opt.BanAfter && a.opt.BanFor > 0 && (a.opt.BanPrivate || !private(ip)) {
		a.bans[ip] = a.now().Add(a.opt.BanFor)
		log.Printf("login: %s banned until %s", ip, a.bans[ip].Format(time.RFC3339))
		a.saveBansLocked()
	}
	return n
}

func (a *Auth) reset(ip string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.fails, ip)
}

func (a *Auth) bansFile() string {
	if a.opt.StateDir == "" {
		return ""
	}
	return filepath.Join(a.opt.StateDir, "bans.json")
}

func (a *Auth) loadBans() {
	f := a.bansFile()
	if f == "" {
		return
	}
	b, err := os.ReadFile(f)
	if err != nil {
		return
	}
	var m map[string]time.Time
	if json.Unmarshal(b, &m) == nil {
		for ip, t := range m {
			if a.now().Before(t) {
				a.bans[ip] = t
			}
		}
	}
}

func (a *Auth) saveBansLocked() {
	f := a.bansFile()
	if f == "" {
		return
	}
	b, _ := json.Marshal(a.bans)
	if err := os.WriteFile(f, b, 0o600); err != nil {
		log.Printf("auth: bans not saved (%v) — is %s writable?", err, a.opt.StateDir)
	}
}

// Describe is for the start-up log (never a password).
func (a *Auth) Describe() string {
	var out []string
	for _, acc := range a.accounts {
		kind := "plain password"
		if IsHash(acc.password) {
			kind = "bcrypt hash"
		}
		if acc.Demo {
			kind += ", read-only demo"
		} else if a.totp != nil {
			kind += " + authenticator code"
		}
		out = append(out, acc.User+" ("+kind+")")
	}
	return strings.Join(out, ", ")
}
