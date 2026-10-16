use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    App, AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, AppResult};

const TRAY_ID: &str = "main";
pub const NEW_EVENT_EVENT: &str = "tray://new-event";

static RUN_IN_BACKGROUND: AtomicBool = AtomicBool::new(true);

pub fn runs_in_background() -> bool {
    RUN_IN_BACKGROUND.load(Ordering::Relaxed)
}

/// Keeps the process alive in the system tray after the window closes, or quits on close.
pub fn set_run_in_background(app: &AppHandle, enabled: bool) {
    RUN_IN_BACKGROUND.store(enabled, Ordering::Relaxed);
    if let Some(tray) = app.tray_by_id(TRAY_ID)
        && let Err(error) = tray.set_visible(enabled)
    {
        eprintln!("could not update the tray icon visibility: {error}");
    }
}

pub fn is_background_launch() -> bool {
    std::env::args_os().any(|argument| argument == "--background")
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let new_event = MenuItem::with_id(app, "new-event", "New event", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Clay Calendar", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&new_event, &open, &separator, &quit])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Clay Calendar")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "new-event" => {
                show_main_window(app);
                if let Err(error) = app.emit_to("main", NEW_EVENT_EVENT, ()) {
                    eprintln!("could not open the new event dialog: {error}");
                }
            }
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn autostart_change(current: bool, requested: bool) -> Option<bool> {
    (current != requested).then_some(requested)
}

pub fn set_autostart(app: &AppHandle, enabled: bool) -> AppResult<()> {
    let result = if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
    result.map_err(|error| {
        let action = if enabled { "enable" } else { "disable" };
        AppError::Configuration(format!(
            "could not {action} launch at system startup: {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autostart_only_changes_when_requested_value_differs() {
        assert_eq!(autostart_change(false, false), None);
        assert_eq!(autostart_change(true, true), None);
        assert_eq!(autostart_change(false, true), Some(true));
        assert_eq!(autostart_change(true, false), Some(false));
    }
}
