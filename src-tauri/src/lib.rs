mod auth;
mod commands;
mod db;
mod error;
mod google;
mod model;
mod sync;

use std::time::Duration;

use auth::AuthService;
use db::Repository;
use google::GoogleClient;
use sync::SyncEngine;
use tauri::Manager;

pub struct AppState {
    repo: Repository,
    auth: AuthService,
    sync: SyncEngine,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let repo = tauri::async_runtime::block_on(Repository::open(
                &data_dir.join("calendar.sqlite3"),
            ))?;
            let auth = AuthService::from_build_config()?;
            let google = GoogleClient::new(auth.clone())?;
            let sync = SyncEngine::new(repo.clone(), google);
            app.manage(AppState {
                repo: repo.clone(),
                auth,
                sync: sync.clone(),
            });
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
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Clay Calendar");
}
