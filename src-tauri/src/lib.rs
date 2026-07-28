mod auth;
mod db;
mod error;
mod google;
mod model;
mod sync;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run Clay Calendar");
}
