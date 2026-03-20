#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;

use audio::run_enhancement;
use tauri::async_runtime::spawn_blocking;

#[tauri::command]
async fn enhance_audio(
    input_path: String,
    gain_db: f32,
    voice_focused_enabled: bool,
    voice_focused_strength: f32,
    chair_suppress_enabled: bool,
    chair_suppress_strength: f32,
    aggressive_enabled: bool,
    aggressive_strength: f32,
    max_combined_noise_reduction: f32,
    vocal_brightness: f32,
    advanced_cleanup: bool,
) -> Result<audio::EnhanceResponse, String> {
    spawn_blocking(move || {
        let path = std::path::PathBuf::from(input_path);
        run_enhancement(
            path.as_path(),
            gain_db,
            voice_focused_enabled,
            voice_focused_strength,
            chair_suppress_enabled,
            chair_suppress_strength,
            aggressive_enabled,
            aggressive_strength,
            max_combined_noise_reduction,
            vocal_brightness,
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
