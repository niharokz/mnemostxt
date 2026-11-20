//! The app's own folders on Linux and Windows are named after the app
//! (~/.config/mnemostxt, ~/.local/share/mnemostxt, %APPDATA%\mnemostxt …):
//! tauri.linux.conf.json and tauri.windows.conf.json set the identifier to
//! "mnemostxt". Android keeps ar.nih.mnemostxt, its package name.
//!
//! Versions before 0.1.0 used ar.nih.mnemostxt everywhere. At start, before
//! the window opens, those folders are moved to the new names, once.

use std::fs;
use std::path::{Path, PathBuf};

pub const OLD_ID: &str = "ar.nih.mnemostxt";

/// The folders Tauri and the web view keep per app, by base folder.
fn bases() -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    if cfg!(windows) {
        // app_config_dir / app_data_dir: %APPDATA%; app_local_data_dir and
        // the WebView2 data: %LOCALAPPDATA%
        [env("APPDATA"), env("LOCALAPPDATA")].into_iter().flatten().collect()
    } else {
        let home = env("HOME");
        let xdg = |k: &str, rel: &str| env(k).or_else(|| home.as_ref().map(|h| h.join(rel)));
        [xdg("XDG_CONFIG_HOME", ".config"), xdg("XDG_DATA_HOME", ".local/share"), xdg("XDG_CACHE_HOME", ".cache")]
            .into_iter()
            .flatten()
            .collect()
    }
}

/// Moves each <base>/ar.nih.mnemostxt to <base>/<id> when the new one does
/// not exist yet. A folder that cannot be renamed (another drive, a file in
/// use) is copied instead and the old one kept. Never overwrites anything.
pub fn move_old(id: &str) {
    move_in(&bases(), id);
}

fn move_in(bases: &[PathBuf], id: &str) {
    if id == OLD_ID {
        return;
    }
    for base in bases {
        let (old, new) = (base.join(OLD_ID), base.join(id));
        if !old.is_dir() || new.exists() {
            continue;
        }
        if fs::rename(&old, &new).is_err() {
            let _ = copy_tree(&old, &new);
        }
    }
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let (src, dst) = (e.path(), to.join(e.file_name()));
        let t = e.file_type()?;
        if t.is_dir() {
            let _ = copy_tree(&src, &dst);
        } else if t.is_file() {
            let _ = fs::copy(&src, &dst); // a locked file is skipped, the rest still comes
        }
    }
    Ok(())
}

/// "mnemostxt --diff left right" (also -d): the two files to compare.
pub fn compare_args(args: &[String]) -> Option<(String, String)> {
    let i = args.iter().position(|a| a == "--diff" || a == "-d")?;
    match (args.get(i + 1), args.get(i + 2)) {
        (Some(a), Some(b)) if !a.starts_with('-') && !b.starts_with('-') => Some((a.clone(), b.clone())),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_tree_copies_nested_files() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a"), d.path().join("b"));
        fs::create_dir_all(a.join("x/y")).unwrap();
        fs::write(a.join("x/y/f.txt"), "hi").unwrap();
        fs::write(a.join("top.json"), "{}").unwrap();
        copy_tree(&a, &b).unwrap();
        assert_eq!(fs::read_to_string(b.join("x/y/f.txt")).unwrap(), "hi");
        assert_eq!(fs::read_to_string(b.join("top.json")).unwrap(), "{}");
    }

    #[test]
    fn old_folders_move_once_and_never_overwrite() {
        let d = tempfile::tempdir().unwrap();
        let (b1, b2) = (d.path().join("config"), d.path().join("data"));
        fs::create_dir_all(b1.join(OLD_ID)).unwrap();
        fs::write(b1.join(OLD_ID).join("bootstrap.json"), "{\"notes\":1}").unwrap();
        fs::create_dir_all(b2.join(OLD_ID)).unwrap();
        fs::create_dir_all(b2.join("mnemostxt")).unwrap();
        fs::write(b2.join("mnemostxt").join("session.json"), "new").unwrap();
        move_in(&[b1.clone(), b2.clone()], "mnemostxt");
        assert_eq!(fs::read_to_string(b1.join("mnemostxt/bootstrap.json")).unwrap(), "{\"notes\":1}");
        assert!(!b1.join(OLD_ID).exists());
        assert!(b2.join(OLD_ID).exists(), "the new folder existed: the old one stays");
        assert_eq!(fs::read_to_string(b2.join("mnemostxt/session.json")).unwrap(), "new");
        move_in(&[b1.clone()], OLD_ID); // Android-style id: nothing happens
        assert!(b1.join("mnemostxt").exists());
    }

    #[test]
    fn compare_args_need_two_paths() {
        let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(compare_args(&v(&["m", "--diff", "a", "b"])), Some(("a".into(), "b".into())));
        assert_eq!(compare_args(&v(&["m", "-d", "a"])), None);
        assert_eq!(compare_args(&v(&["m", "a", "b"])), None);
    }
}
