//! The optional tray icon (desktop). With it on, closing the window only hides
//! it: mnemostxt keeps running, so opening a file from the file manager or with
//! `mnemostxt file.txt` shows it instantly. The frontend decides when to hide
//! (frontend/src/ui/shell.js); "Quit" asks the frontend to save, then exits.

use crate::util::{err, Res};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const ID: &str = "main";

/// Brings the main window back (from the tray, minimised or behind others).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The tray library Linux needs is loaded at run time; without it the tray
/// crate would abort the app, so look for it first.
#[cfg(target_os = "linux")]
fn tray_library_present() -> bool {
    const NAMES: [&str; 2] = ["libayatana-appindicator3.so.1", "libappindicator3.so.1"];
    const DIRS: [&str; 6] =
        ["/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/usr/lib64", "/usr/lib", "/lib/x86_64-linux-gnu", "/usr/local/lib"];
    DIRS.iter().any(|d| NAMES.iter().any(|n| std::path::Path::new(d).join(n).exists()))
}

pub fn set(app: &AppHandle, enabled: bool) -> Res<()> {
    if !enabled {
        app.remove_tray_by_id(ID);
        return Ok(());
    }
    if app.tray_by_id(ID).is_some() {
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    if !tray_library_present() {
        return Err(err(
            "UNAVAILABLE",
            "the tray needs libayatana-appindicator3 (Debian/Ubuntu: sudo apt install libayatana-appindicator3-1)",
        ));
    }
    let e = |x: tauri::Error| err("IO", x);
    let show = MenuItem::with_id(app, "show", "Show MnemoTXT", true, None::<&str>).map_err(e)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(e)?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(e)?;
    let mut b = TrayIconBuilder::with_id(ID).tooltip("MnemoTXT").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.on_menu_event(|app, ev| match ev.id.as_ref() {
        "show" => show_main(app),
        "quit" => {
            // the frontend flushes unsaved edits and calls app_exit; exit anyway if it cannot
            let _ = app.emit_to("main", "quit-requested", ());
            let h = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                h.exit(0);
            });
        }
        _ => {}
    })
    .on_tray_icon_event(|tray, ev| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
            show_main(tray.app_handle());
        }
    })
    .build(app)
    .map_err(e)?;
    Ok(())
}
