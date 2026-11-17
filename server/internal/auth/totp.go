package auth

// Optional second step for the owner: a time-based one-time code (RFC 6238,
// HMAC-SHA1, 6 digits, 30 seconds), as shown by any authenticator app.
// Standard library only. A code is accepted for its own 30 seconds and the
// ones just before and after (clock drift), and never twice.

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const totpStep = 30

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// ParseTOTPSecret reads a base32 secret (spaces, dashes and lower case allowed).
func ParseTOTPSecret(s string) ([]byte, error) {
	s = strings.ToUpper(strings.NewReplacer(" ", "", "-", "", "=", "").Replace(strings.TrimSpace(s)))
	key, err := b32.DecodeString(s)
	if err != nil || len(key) < 10 {
		return nil, fmt.Errorf("not a base32 secret of at least 16 characters (make one with: mnemostxt totp-secret)")
	}
	return key, nil
}

// NewTOTPSecret makes a fresh secret and the otpauth:// link for an authenticator app.
func NewTOTPSecret(user string) (secret, link string) {
	key := make([]byte, 20)
	_, _ = rand.Read(key)
	secret = b32.EncodeToString(key)
	label := url.PathEscape("MnemoTXT:" + user)
	return secret, "otpauth://totp/" + label + "?secret=" + secret + "&issuer=MnemoTXT"
}

func totpCode(key []byte, counter uint64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	m := hmac.New(sha1.New, key)
	m.Write(msg[:])
	sum := m.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	n := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", n%1_000_000)
}

// totpCounter returns the time step a code belongs to, or 0 when it is wrong.
func totpCounter(key []byte, code string, now time.Time) uint64 {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != 6 {
		return 0
	}
	cur := uint64(now.Unix() / totpStep)
	var hit uint64
	for _, c := range []uint64{cur - 1, cur, cur + 1} {
		if subtle.ConstantTimeCompare([]byte(totpCode(key, c)), []byte(code)) == 1 {
			hit = c
		}
	}
	return hit
}
