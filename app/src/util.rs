//! Small helpers shared by the commands: error codes, path normalising and
//! modification times. Errors cross to JavaScript as "CODE: message"
//! (frontend/src/backend/errors.js turns them back into codes).

use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub type Res<T> = Result<T, String>;

pub fn err(code: &str, msg: impl std::fmt::Display) -> String {
    format!("{code}: {msg}")
}

/// Maps an io::Error to a coded message, naming the path it concerns.
pub fn io_err(e: io::Error, path: &Path) -> String {
    let code = match e.kind() {
        io::ErrorKind::NotFound => "NOT_FOUND",
        io::ErrorKind::PermissionDenied => "DENIED",
        io::ErrorKind::AlreadyExists => "EXISTS",
        io::ErrorKind::InvalidInput | io::ErrorKind::InvalidData => "INVALID",
        _ => "IO",
    };
    err(code, format!("{} ({})", e, show(path)))
}

/// Forward slashes everywhere: the frontend speaks one path style on every OS
/// (Windows accepts "D:/notes/a.md" as well as "D:\notes\a.md").
pub fn show(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    s.strip_prefix("//?/").map(str::to_string).unwrap_or(s)
}

/// A path from the frontend: "~" expands to home, separators are tidied.
pub fn input(p: &str, home: Option<&Path>) -> Res<PathBuf> {
    let p = p.trim();
    if p.is_empty() {
        return Err(err("INVALID", "empty path"));
    }
    if p.contains('\0') {
        return Err(err("INVALID", "path contains NUL"));
    }
    if let (Some(rest), Some(h)) = (p.strip_prefix('~'), home) {
        if rest.is_empty() || rest.starts_with('/') || rest.starts_with('\\') {
            return Ok(h.join(rest.trim_start_matches(['/', '\\'])));
        }
    }
    Ok(PathBuf::from(p))
}

/// Modification time in milliseconds since 1970 (the frontend's conflict check).
pub fn mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// True when `child` is `root` or inside it (both made absolute and canonical
/// where they exist; case-insensitive on Windows).
pub fn is_inside(child: &Path, root: &Path) -> bool {
    let c = canonical_or_self(child);
    let r = canonical_or_self(root);
    if cfg!(windows) {
        let c = show(&c).to_lowercase();
        let r = show(&r).to_lowercase().trim_end_matches('/').to_string();
        c == r || c.starts_with(&(r + "/"))
    } else {
        c.starts_with(&r)
    }
}

/// Canonical form of the longest existing prefix, plus the rest as given.
pub fn canonical_or_self(p: &Path) -> PathBuf {
    if let Ok(c) = dunce::canonicalize(p) {
        return c;
    }
    match (p.parent(), p.file_name()) {
        (Some(parent), Some(name)) if parent != p => canonical_or_self(parent).join(name),
        _ => p.to_path_buf(),
    }
}

/// Decodes %XX escapes (paths arrive URL-encoded in IPC headers).
pub fn percent_decode(s: &str) -> Res<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3).ok_or_else(|| err("INVALID", "bad escape"))?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| err("INVALID", "bad escape"))?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| err("INVALID", "path is not UTF-8"))
}

/// This computer's name, for scratch file names (the user can change it).
pub fn host_name() -> String {
    let from_env = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).ok();
    let from_file = || std::fs::read_to_string("/etc/hostname").ok().map(|s| s.trim().to_string());
    from_env.filter(|s| !s.is_empty()).or_else(from_file).filter(|s| !s.is_empty()).unwrap_or_else(|| std::env::consts::OS.to_string())
}

/// Keeps letters, digits and dashes (a device name goes into file names).
pub fn device_slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').chars().take(40).collect::<String>();
    if out.is_empty() {
        "device".into()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_home_and_normalises() {
        let home = Path::new("/home/me");
        assert_eq!(input("~/notes", Some(home)).unwrap(), PathBuf::from("/home/me/notes"));
        assert_eq!(input("~", Some(home)).unwrap(), PathBuf::from("/home/me/"));
        assert_eq!(input("~x", Some(home)).unwrap(), PathBuf::from("~x"));
        assert!(input("  ", Some(home)).is_err());
        assert_eq!(show(Path::new("a\\b/c")), "a/b/c");
        assert_eq!(show(Path::new("//?/D:/x")), "D:/x");
    }

    #[test]
    fn decodes_and_slugs() {
        assert_eq!(percent_decode("D%3A%2Fnotes%2Fa%20b%C3%A9.md").unwrap(), "D:/notes/a bé.md");
        assert!(percent_decode("%zz").is_err() && percent_decode("%4").is_err());
        assert_eq!(device_slug("Nihar's ThinkPad!"), "Nihar-s-ThinkPad");
        assert_eq!(device_slug("…"), "device");
    }

    #[test]
    fn inside_checks_real_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("notes");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert!(is_inside(&root.join("sub/new.md"), &root));
        assert!(is_inside(&root, &root));
        assert!(!is_inside(&dir.path().join("notes2/a"), &root));
        assert!(!is_inside(&root.join("../escape.md"), &root));
    }
}
