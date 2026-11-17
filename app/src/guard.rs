//! Places the editor never reads or writes, whatever the frontend asks for:
//! credential stores (SSH and GPG keys, cloud and git tokens, browser
//! profiles, keyrings) and system folders. The desktop app opens any file the
//! user picks, so this is a deny-list, not a jail: it stops a bad note or a
//! bug in the UI from reaching secrets, without getting in the way of normal
//! editing. Paths are checked after symlinks are resolved.

use std::path::Path;

/// Under the home folder (forward slashes, compared without case on Windows).
const HOME_SECRETS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".password-store",
    ".pki",
    ".netrc",
    ".git-credentials",
    ".mozilla",
    ".thunderbird",
    ".config/gh",
    ".config/gcloud",
    ".config/rclone",
    ".config/google-chrome",
    ".config/chromium",
    ".config/BraveSoftware",
    ".config/Signal",
    ".config/keepassxc",
    ".local/share/keyrings",
    ".local/share/kwalletd",
    "AppData/Roaming/Microsoft/Credentials",
    "AppData/Roaming/Microsoft/Protect",
    "AppData/Roaming/Mozilla",
    "AppData/Local/Microsoft/Credentials",
    "AppData/Local/Google/Chrome/User Data",
    "AppData/Local/Microsoft/Edge/User Data",
];

/// System folders: reading is fine (a config file), writing is not.
const SYSTEM_WRITE: &[&str] = &[
    "/bin",
    "/boot",
    "/etc",
    "/lib",
    "/lib64",
    "/sbin",
    "/usr",
    "/proc",
    "/sys",
    "/dev",
    "C:/Windows",
    "C:/Program Files",
    "C:/Program Files (x86)",
];

/// Never at all, even to read.
const SYSTEM_READ: &[&str] = &["/etc/shadow", "/etc/gshadow", "/etc/sudoers", "/etc/ssh", "/proc", "/sys"];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Access {
    Read,
    Write,
}

fn norm(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let s = s.strip_prefix("//?/").unwrap_or(&s).trim_end_matches('/').to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

fn under(path: &str, root: &str) -> bool {
    let root = root.trim_end_matches('/');
    !root.is_empty() && (path == root || path.starts_with(&format!("{root}/")))
}

/// `real` is the canonical path (symlinks resolved, as far as it exists).
/// Returns the reason it is refused, or None.
pub fn refused(real: &Path, home: Option<&Path>, access: Access) -> Option<&'static str> {
    let p = norm(real);
    let n = |s: &str| if cfg!(windows) { s.to_lowercase() } else { s.to_string() };
    if let Some(h) = home {
        let h = norm(h);
        if HOME_SECRETS.iter().any(|s| under(&p, &format!("{h}/{}", n(s)))) {
            return Some("holds keys or passwords");
        }
    }
    if SYSTEM_READ.iter().any(|s| under(&p, &n(s))) {
        return Some("is a protected system location");
    }
    if access == Access::Write && SYSTEM_WRITE.iter().any(|s| under(&p, &n(s))) {
        return Some("is a system folder");
    }
    None
}

/// Folders a search never walks into (the secret stores under home).
pub fn secret_dirs(home: Option<&Path>) -> Vec<std::path::PathBuf> {
    home.map(|h| HOME_SECRETS.iter().map(|s| h.join(s)).collect()).unwrap_or_default()
}

/// The error the commands return for a refused path.
pub fn check(real: &Path, home: Option<&Path>, access: Access, shown: &Path) -> Result<(), String> {
    match refused(real, home, access) {
        Some(why) => Err(format!("DENIED: {} {why}; {} does not open it", shown.display(), "MnemoTXT")),
        None => Ok(()),
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn refuses_secrets_and_system_writes() {
        let home = Path::new("/home/me");
        let r = |p: &str, a| refused(Path::new(p), Some(home), a);
        assert!(r("/home/me/.ssh/id_ed25519", Access::Read).is_some());
        assert!(r("/home/me/.ssh", Access::Read).is_some());
        assert!(r("/home/me/.config/gh/hosts.yml", Access::Write).is_some());
        assert!(r("/home/me/.sshx/notes.md", Access::Read).is_none());
        assert!(r("/home/me/notes/.ssh-tips.md", Access::Write).is_none());
        assert!(r("/home/me/notes/a.md", Access::Write).is_none());
        assert!(r("/etc/hosts", Access::Read).is_none());
        assert!(r("/etc/hosts", Access::Write).is_some());
        assert!(r("/etc/shadow", Access::Read).is_some());
        assert!(r("/etcetera/a.md", Access::Write).is_none());
        assert!(r("/proc/self/environ", Access::Read).is_some());
        assert!(refused(Path::new("/home/me/.ssh/x"), None, Access::Read).is_none());
    }
}
