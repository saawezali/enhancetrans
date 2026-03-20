#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;

use audio::run_enhancement;
use tauri::async_runtime::spawn_blocking;

#[tauri::command]
async fn enhance_audio(
    input_path: String,
    gain_db: f32,
    noise_reduction_strength: f32,
    noise_profile: String,
    advanced_cleanup: bool,
) -> Result<audio::EnhanceResponse, String> {
    spawn_blocking(move || {
        let path = std::path::PathBuf::from(input_path);
        run_enhancement(
            path.as_path(),
            gain_db,
            noise_reduction_strength,
            noise_profile.as_str(),
            advanced_cleanup,
        )
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| format!("Enhancement worker failed: {err}"))?
}

fn main() {
    tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![enhance_audio])
        .run(tauri::generate_context!())
        .expect("failed to run EnhanceTrans");
}
