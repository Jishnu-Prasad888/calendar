mod auth;
mod commands;
mod db;
mod desktop;
mod error;
mod google;
mod model;
mod reminder;
mod sync;

use std::time::Duration;

use auth::AuthService;
use db::Repository;
use google::GoogleClient;
use sync::SyncEngine;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

pub struct AppState {
    repo: Repository,
    auth: AuthService,
    sync: SyncEngine,
    preferences_lock: tokio::sync::Mutex<()>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            desktop::show_main_window(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            desktop::setup_tray(app)?;
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let repo = tauri::async_runtime::block_on(Repository::open(
                &data_dir.join("calendar.sqlite3"),
            ))?;
            let preferences = tauri::async_runtime::block_on(repo.preferences())?;
            let client_secret = tauri::async_runtime::block_on(AuthService::stored_client_secret())
                .unwrap_or_else(|error| {
                    eprintln!("could not load Google OAuth client secret: {error}");
                    None
                });
            let auth = AuthService::new(&preferences.google_client_id, client_secret)?;
            let google = GoogleClient::new(auth.clone())?;
            let sync = SyncEngine::new(repo.clone(), google);
            app.manage(AppState {
                repo: repo.clone(),
                auth,
                sync: sync.clone(),
                preferences_lock: tokio::sync::Mutex::new(()),
            });
            match app.autolaunch().is_enabled() {
                Ok(enabled) if enabled != preferences.autostart => {
                    if let Err(error) = desktop::set_autostart(app.handle(), preferences.autostart)
                    {
                        eprintln!("could not reconcile launch-at-startup registration: {error}");
                    }
                }
                Err(error) => {
                    eprintln!("could not inspect launch-at-startup registration: {error}");
                }
                _ => {}
            }
            reminder::spawn(app.handle().clone(), repo.clone());
            tauri::async_runtime::spawn(async move {
                loop {
                    let minutes = repo
                        .preferences()
                        .await
                        .map(|value| value.sync_interval_minutes)
                        .unwrap_or(15);
                    tokio::time::sleep(Duration::from_secs(u64::from(minutes) * 60)).await;
                    let _ = sync.sync_all().await;
                }
            });
            if !desktop::is_background_launch() {
                desktop::show_main_window(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::get_events,
            commands::get_task_lists,
            commands::start_google_auth,
            commands::remove_account,
            commands::sync_now,
            commands::create_event,
            commands::update_event,
            commands::delete_event,
            commands::respond_to_event,
            commands::update_preferences,
            commands::update_google_oauth_configuration,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Clay Calendar");
}
