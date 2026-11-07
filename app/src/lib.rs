//! mnemostxt — the Tauri side of the desktop (Linux, Windows) and Android apps.
//! The editor UI is frontend/; these commands give it the file system.
//! Every command is async, so it runs off the main (UI) thread.
//!
//! File bytes cross the bridge raw on the desktop (read_raw / write_raw: no
//! base64, no JSON), which keeps opening big files fast. Android, and any web
//! view that cannot send raw bytes, uses the base64 pair read_file / write_file.

mod files;
mod search;
mod session;
#[cfg(desktop)]
mod tray;
mod util;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use util::{err, show, Res};

#[cfg(desktop)]
use tauri::Emitter;

/// What this device remembers (bootstrap.json in the app's config folder).
struct AppState {
    notes: Mutex<Option<PathBuf>>,
    boot: Mutex<session::Bootstrap>,
    startup: Vec<String>,
}

impl AppState {
    fn notes(&self) -> Res<PathBuf> {
        self.notes.lock().unwrap().clone().ok_or_else(|| err("INVALID", "no notes folder chosen yet"))
    }
    fn app_dir(&self) -> String {
        self.boot.lock().unwrap().app_dir.clone().unwrap_or_else(|| files::DEFAULT_APP_DIR.to_string())
    }
}

#[derive(Serialize)]
struct Info {
    platform: &'static str,
    version: String,
    home: Option<String>,
    notes_dir: Option<String>,
    default_notes_dir: String,
    app_dir: String,
    device_name: String,
    device_name_set: bool,
    args: Vec<String>,
}

fn home(app: &AppHandle) -> Option<PathBuf> {
    app.path().home_dir().ok()
}
fn data_dir(app: &AppHandle) -> Res<PathBuf> {
    app.path().app_local_data_dir().map_err(|e| err("IO", e))
}
fn config_dir(app: &AppHandle) -> Res<PathBuf> {
    app.path().app_config_dir().map_err(|e| err("IO", e))
}
fn p(app: &AppHandle, s: &str) -> Res<PathBuf> {
    files::arg(s, home(app).as_deref())
}

/// Files and folders named on the command line ("mnemostxt notes.md ~/notes").
fn cli_paths(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let pb = PathBuf::from(a);
            let abs = if pb.is_absolute() { pb } else { cwd.join(pb) };
            show(&util::canonical_or_self(&abs))
        })
        .collect()
}

/// A request header as text ("x-path" arrives URL-encoded).
fn header(req: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    req.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
}

// ── start-up and device settings ────────────────────────────────────────────

#[tauri::command]
async fn app_info(app: AppHandle, state: State<'_, AppState>) -> Res<Info> {
    let h = home(&app);
    let default = if cfg!(target_os = "android") {
        "/storage/emulated/0/notes".to_string()
    } else {
        h.as_ref().map(|h| show(&h.join("notes"))).unwrap_or_else(|| "notes".into())
    };
    let boot = state.boot.lock().unwrap().clone();
    Ok(Info {
        platform: std::env::consts::OS,
        version: app.package_info().version.to_string(),
        home: h.as_deref().map(show),
        notes_dir: state.notes.lock().unwrap().as_deref().map(show),
        default_notes_dir: default,
        app_dir: state.app_dir(),
        device_name_set: boot.device_name.is_some(),
        device_name: boot.device_name.unwrap_or_else(util::host_name),
        args: state.startup.clone(),
    })
}

fn save_boot(app: &AppHandle, state: &AppState) -> Res<()> {
    let b = state.boot.lock().unwrap().clone();
    session::save_bootstrap(&config_dir(app)?, &b)
}

#[tauri::command]
async fn set_notes_dir(app: AppHandle, state: State<'_, AppState>, path: String) -> Res<String> {
    let dir = p(&app, &path)?;
    std::fs::create_dir_all(&dir).map_err(|e| util::io_err(e, &dir))?;
    let dir = dunce::canonicalize(&dir).map_err(|e| util::io_err(e, &dir))?;
    std::fs::read_dir(&dir).map_err(|e| util::io_err(e, &dir))?; // readable?
    state.boot.lock().unwrap().notes_dir = Some(show(&dir));
    save_boot(&app, &state)?;
    *state.notes.lock().unwrap() = Some(dir.clone());
    Ok(show(&dir))
}

/// This device's name and app folder (Preferences → This device).
#[tauri::command]
async fn set_device_config(app: AppHandle, state: State<'_, AppState>, device_name: Option<String>, app_dir: Option<String>) -> Res<()> {
    {
        let mut b = state.boot.lock().unwrap();
        if let Some(n) = device_name {
            let n = n.trim();
            b.device_name = if n.is_empty() { None } else { Some(util::device_slug(n)) };
        }
        if let Some(d) = app_dir {
            let d = files::valid_app_dir(&d)?;
            b.app_dir = if d == files::DEFAULT_APP_DIR { None } else { Some(d) };
        }
    }
    save_boot(&app, &state)
}

// ── files ───────────────────────────────────────────────────────────────────

#[tauri::command]
async fn list_dir(app: AppHandle, path: String) -> Res<Vec<files::Entry>> {
    files::list(&p(&app, &path)?)
}

/// Fast path: the reply is raw bytes (8-byte mtime, then the file).
#[tauri::command]
async fn read_raw(app: AppHandle, path: String) -> Res<tauri::ipc::Response> {
    Ok(tauri::ipc::Response::new(files::read_framed(&p(&app, &path)?)?))
}

/// Fast path: the request body is the file; path and expected mtime are headers.
#[tauri::command]
async fn write_raw(app: AppHandle, request: tauri::ipc::Request<'_>) -> Res<files::WriteOut> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(err("RAW", "this web view did not send raw bytes"));
    };
    let path = util::percent_decode(&header(&request, "x-path").ok_or_else(|| err("INVALID", "no path"))?)?;
    let expected =
        header(&request, "x-expect").filter(|s| !s.is_empty()).map(|s| s.parse::<i64>()).transpose().map_err(|e| err("INVALID", e))?;
    files::write_bytes(&p(&app, &path)?, bytes, expected)
}

#[tauri::command]
async fn read_file(app: AppHandle, path: String) -> Res<files::ReadOut> {
    files::read(&p(&app, &path)?)
}

#[tauri::command]
async fn write_file(app: AppHandle, path: String, data: String, expected_mtime: Option<i64>) -> Res<files::WriteOut> {
    files::write(&p(&app, &path)?, &data, expected_mtime)
}

#[tauri::command]
async fn stat_path(app: AppHandle, path: String) -> Res<Option<files::Stat>> {
    files::stat(&p(&app, &path)?)
}

#[tauri::command]
async fn mkdir_all(app: AppHandle, path: String) -> Res<()> {
    files::mkdir_all(&p(&app, &path)?)
}

#[tauri::command]
async fn create_file(app: AppHandle, path: String) -> Res<files::WriteOut> {
    files::create(&p(&app, &path)?)
}

#[tauri::command]
async fn rename_path(app: AppHandle, from: String, to: String) -> Res<()> {
    files::rename(&p(&app, &from)?, &p(&app, &to)?)
}

/// Deletes a file inside the app folder only (state, backups, empty scratch).
#[tauri::command]
async fn remove_file(app: AppHandle, state: State<'_, AppState>, path: String) -> Res<()> {
    files::remove(&p(&app, &path)?, &state.notes()?, &state.app_dir())
}

#[tauri::command]
async fn trash_path(app: AppHandle, state: State<'_, AppState>, path: String) -> Res<()> {
    let notes = state.notes.lock().unwrap().clone();
    files::trash(&p(&app, &path)?, notes.as_deref(), &state.app_dir())
}

#[tauri::command]
async fn trash_purge(state: State<'_, AppState>, days: u64) -> Res<files::PurgeOut> {
    files::purge(&state.notes()?, &state.app_dir(), days)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn search(
    app: AppHandle,
    state: State<'_, AppState>,
    roots: Vec<String>,
    query: String,
    regex: bool,
    case_sensitive: bool,
    hidden: Vec<String>,
    max: usize,
) -> Res<Vec<search::Hit>> {
    let roots = roots.iter().map(|r| p(&app, r)).collect::<Res<Vec<_>>>()?;
    let skip: Vec<PathBuf> = state.notes.lock().unwrap().as_deref().map(|n| files::app_dir(n, &state.app_dir())).into_iter().collect();
    search::search(&roots, &skip, &query, regex, case_sensitive, &hidden, max.clamp(1, 10_000))
}

// ── 0.0.1 hot-exit storage (read once by 0.0.2, then emptied) ───────────────

#[tauri::command]
async fn session_load(app: AppHandle) -> Res<Option<String>> {
    session::session_load(&data_dir(&app)?)
}

#[tauri::command]
async fn session_save(app: AppHandle, json: String) -> Res<()> {
    session::session_save(&data_dir(&app)?, &json)
}

#[tauri::command]
async fn backup_write(app: AppHandle, id: String, text: String) -> Res<()> {
    session::backup_write(&data_dir(&app)?, &id, &text)
}

#[tauri::command]
async fn backup_read(app: AppHandle, id: String) -> Res<Option<String>> {
    session::backup_read(&data_dir(&app)?, &id)
}

#[tauri::command]
async fn backup_delete(app: AppHandle, id: String) -> Res<()> {
    session::backup_delete(&data_dir(&app)?, &id)
}

#[tauri::command]
async fn backup_list(app: AppHandle) -> Res<Vec<String>> {
    Ok(session::backup_list(&data_dir(&app)?))
}

// ── desktop: tray and quitting ──────────────────────────────────────────────

/// Shows or removes the tray icon (Preferences → Keep running in the tray).
#[tauri::command]
async fn tray_set(app: AppHandle, enabled: bool) -> Res<()> {
    #[cfg(desktop)]
    return tray::set(&app, enabled);
    #[cfg(not(desktop))]
    {
        let _ = (app, enabled);
        Err(err("INVALID", "no tray on this platform"))
    }
}

/// Ends the app (after the frontend saved its state); the window's close
/// button may only hide it while the tray is on.
#[tauri::command]
async fn app_exit(app: AppHandle) -> Res<()> {
    app.exit(0);
    Ok(())
}

// ── app ─────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().unwrap_or_default();
    let startup = if cfg!(mobile) { vec![] } else { cli_paths(&args, &cwd) };

    #[allow(unused_mut)] // only the desktop build adds plugins below
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // a second launch ("open with mnemostxt", "m file.txt") hands its files to the
        // running window, which also comes back from the tray
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
                let paths = cli_paths(&argv, Path::new(&cwd));
                tray::show_main(app);
                if !paths.is_empty() {
                    let _ = app.emit_to("main", "open-files", paths);
                }
            }))
            .plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let boot = config_dir(app.handle()).map(|c| session::load_bootstrap(&c)).unwrap_or_default();
            let notes = boot.notes_dir.clone().map(PathBuf::from).filter(|p| p.is_dir());
            app.manage(AppState { notes: Mutex::new(notes), boot: Mutex::new(boot), startup: startup.clone() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            set_notes_dir,
            set_device_config,
            list_dir,
            read_raw,
            write_raw,
            read_file,
            write_file,
            stat_path,
            mkdir_all,
            create_file,
            rename_path,
            remove_file,
            trash_path,
            trash_purge,
            search,
            session_load,
            session_save,
            backup_write,
            backup_read,
            backup_delete,
            backup_list,
            tray_set,
            app_exit
        ])
        .run(tauri::generate_context!())
        .expect("error while running mnemostxt");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_paths_resolve_relative_and_skip_flags() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.md"), "").unwrap();
        let got = cli_paths(&["mnemostxt".into(), "--flag".into(), "a.md".into()], d.path());
        assert_eq!(got, vec![show(&dunce::canonicalize(d.path().join("a.md")).unwrap())]);
    }
}
