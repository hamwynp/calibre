// calibre - Tauri shell. Google Calendar sync lives in `google`, Taskwarrior in `tasks`.

mod google;
mod tasks;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(google::GoogleState::new())
        .invoke_handler(tauri::generate_handler![
            google::google_calendars,
            google::google_events,
            google::google_create,
            tasks::tasks_pending
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
