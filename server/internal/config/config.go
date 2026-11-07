// Package config reads the server settings from MNEMOSTXT_* environment
// variables (in the homelab: the shared .env, passed through docker-compose).
// Editor settings are not here: they live in <notes>/<app folder>/settings.json.
// Every variable is listed, with its default, in .env.example.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Defaults for the download links on the home page (GitLab release permalinks).
const releaseBase = "https://gitlab.com/niharokz/mnemostxt/-/releases/permalink/latest/downloads/"

type Config struct {
	Listen      string // MNEMOSTXT_LISTEN, default :8080
	Notes       string // MNEMOSTXT_NOTES, the notes folder (container: /notes)
	NotesName   string // MNEMOSTXT_NOTES_NAME, shown in the sidebar, default "notes"
	State       string // MNEMOSTXT_STATE, writable folder for bans (container: /state)
	AppDir      string // MNEMOSTXT_APP_DIR, the app folder inside the notes folder, default logs/mnemostxt
	User        string // MNEMOSTXT_USER
	Password    string // MNEMOSTXT_PASSWORD_HASH (bcrypt, preferred) or MNEMOSTXT_PASSWORD (plain or bcrypt)
	DemoUser    string // MNEMOSTXT_DEMO_USER, optional read-only demo account (sample notes)
	DemoPass    string // MNEMOSTXT_DEMO_PASSWORD, shown on the sign-in card
	Landing     bool   // MNEMOSTXT_LANDING, show the About page at /, default true (false: / goes to the app)
	Secret      string // MNEMOSTXT_SECRET, signs sessions; empty = random (sign-in ends on restart)
	MaxFileMB   int    // MNEMOSTXT_MAX_FILE_MB, largest file read or written, default 20
	BanAfter    int    // MNEMOSTXT_BAN_AFTER failed sign-ins in 15 min, default 5
	BanHours    int    // MNEMOSTXT_BAN_HOURS, default 24
	BanPrivate  bool   // MNEMOSTXT_BAN_PRIVATE, also ban LAN/Tailscale addresses, default false
	Hidden      []string
	DownloadAPK string // MNEMOSTXT_URL_APK
	DownloadEXE string // MNEMOSTXT_URL_EXE
	DownloadDEB string // MNEMOSTXT_URL_DEB
	Source      string // MNEMOSTXT_URL_SOURCE
}

// Load reads the environment through getenv (os.Getenv in production).
func Load(getenv func(string) string) (*Config, error) {
	get := func(k, def string) string {
		if v := strings.TrimSpace(getenv(k)); v != "" {
			return v
		}
		return def
	}
	num := func(k string, def, lo, hi int) (int, error) {
		v := get(k, "")
		if v == "" {
			return def, nil
		}
		n, err := strconv.Atoi(v)
		if err != nil || n < lo || n > hi {
			return 0, fmt.Errorf("%s must be a number from %d to %d", k, lo, hi)
		}
		return n, nil
	}
	c := &Config{
		Listen:      get("MNEMOSTXT_LISTEN", ":8080"),
		Notes:       get("MNEMOSTXT_NOTES", "/notes"),
		NotesName:   get("MNEMOSTXT_NOTES_NAME", "notes"),
		State:       get("MNEMOSTXT_STATE", "/state"),
		AppDir:      get("MNEMOSTXT_APP_DIR", "logs/mnemostxt"),
		User:        get("MNEMOSTXT_USER", ""),
		Password:    get("MNEMOSTXT_PASSWORD_HASH", getenv("MNEMOSTXT_PASSWORD")), // a plain password is not trimmed: spaces may be part of it
		DemoUser:    get("MNEMOSTXT_DEMO_USER", ""),
		DemoPass:    getenv("MNEMOSTXT_DEMO_PASSWORD"),
		Landing:     get("MNEMOSTXT_LANDING", "true") != "false",
		Secret:      get("MNEMOSTXT_SECRET", ""),
		BanPrivate:  get("MNEMOSTXT_BAN_PRIVATE", "false") == "true",
		Hidden:      []string{".git", ".trash", ".stfolder", ".stversions", ".obsidian", "node_modules"},
		DownloadAPK: get("MNEMOSTXT_URL_APK", releaseBase+"mnemostxt.apk"),
		DownloadEXE: get("MNEMOSTXT_URL_EXE", releaseBase+"mnemostxt-setup.exe"),
		DownloadDEB: get("MNEMOSTXT_URL_DEB", releaseBase+"mnemostxt.deb"),
		Source:      get("MNEMOSTXT_URL_SOURCE", "https://gitlab.com/niharokz/mnemostxt"),
	}
	var err error
	if c.MaxFileMB, err = num("MNEMOSTXT_MAX_FILE_MB", 20, 1, 200); err != nil {
		return nil, err
	}
	if c.BanAfter, err = num("MNEMOSTXT_BAN_AFTER", 5, 1, 100); err != nil {
		return nil, err
	}
	if c.BanHours, err = num("MNEMOSTXT_BAN_HOURS", 24, 0, 24*365); err != nil {
		return nil, err
	}
	if h := get("MNEMOSTXT_HIDDEN", ""); h != "" {
		for _, x := range strings.Split(h, ",") {
			if x = strings.TrimSpace(x); x != "" {
				c.Hidden = append(c.Hidden, x)
			}
		}
	}
	if c.User == "" || c.Password == "" {
		return nil, fmt.Errorf("set MNEMOSTXT_USER and MNEMOSTXT_PASSWORD_HASH (or MNEMOSTXT_PASSWORD)")
	}
	if h := getenv("MNEMOSTXT_PASSWORD_HASH"); h != "" && !strings.HasPrefix(strings.TrimSpace(h), "$2") {
		return nil, fmt.Errorf("MNEMOSTXT_PASSWORD_HASH must be a bcrypt hash (mnemostxt hash-password)")
	}
	if (c.DemoUser == "") != (c.DemoPass == "") {
		return nil, fmt.Errorf("set both MNEMOSTXT_DEMO_USER and MNEMOSTXT_DEMO_PASSWORD, or neither")
	}
	if c.DemoUser != "" && strings.EqualFold(c.DemoUser, c.User) {
		return nil, fmt.Errorf("MNEMOSTXT_DEMO_USER must differ from MNEMOSTXT_USER")
	}
	if strings.Contains(c.AppDir, "..") || strings.HasPrefix(c.AppDir, "/") {
		return nil, fmt.Errorf("MNEMOSTXT_APP_DIR must be a folder inside the notes folder, like logs/mnemostxt")
	}
	return c, nil
}

// Getenv is os.Getenv, for main.
var Getenv = os.Getenv
