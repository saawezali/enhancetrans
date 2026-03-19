#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;

use audio::run_enhancement;
use tauri::api::dialog::blocking::FileDialogBuilder;

#[tauri::command]
fn pick_audio_file() -> Option<String> {
    FileDialogBuilder::new()
        .set_title("Choose an audio file")
        .add_filter(
            "Audio",
            &[
                "mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "aiff", "opus", "amr", "alac",
            ],
        )
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn enhance_audio(input_path: String, gain_db: f32) -> Result<audio::EnhanceResponse, String> {
    run_enhancement(std::path::Path::new(&input_path), gain_db).map_err(|err| err.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![pick_audio_file, enhance_audio])
        .run(tauri::generate_context!())
        .expect("failed to run EnhanceTrans");
}
