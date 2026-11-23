//! Taskwarrior integration (optional): lists pending tasks via `task export`.

#[tauri::command]
pub async fn tasks_pending() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = std::process::Command::new("task")
            .args(["rc.confirmation=off", "status:pending", "export"])
            .output();
        match out {
            Ok(o) if o.status.success() && !o.stdout.is_empty() => String::from_utf8_lossy(&o.stdout).into_owned(),
            _ => "[]".to_string(), // Taskwarrior not installed / no tasks: just show none
        }
    })
    .await
    .map_err(|e| e.to_string())
}
