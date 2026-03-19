use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;

#[derive(Debug, Serialize)]
pub struct EnhanceResponse {
    pub output_path: String,
}

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("Invalid input file path")]
    InvalidInputPath,
    #[error("Missing file name")]
    MissingFileName,
    #[error("FFmpeg executable not found. Expected either 'ffmpeg' in PATH or './ffmpeg/ffmpeg(.exe)'.")]
    MissingFfmpeg,
    #[error("Audio processing failed: {0}")]
    ProcessingFailed(String),
}

pub fn build_output_path(input_path: &Path) -> Result<PathBuf, AudioError> {
    let parent = input_path.parent().ok_or(AudioError::InvalidInputPath)?;
    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or(AudioError::MissingFileName)?;
    let ext = input_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("wav");

    let mut candidate = parent.join(format!("enhanced_{}.{}", stem, ext));
    if !candidate.exists() {
        return Ok(candidate);
    }

    for idx in 1..=10_000 {
        let trial = parent.join(format!("enhanced_{}_{}.{}", stem, idx, ext));
        if !trial.exists() {
            candidate = trial;
            break;
        }
    }

    Ok(candidate)
}

pub fn detect_ffmpeg_path() -> Result<String, AudioError> {
    let local_unix = PathBuf::from("ffmpeg/ffmpeg");
    if local_unix.exists() {
        return Ok(local_unix.to_string_lossy().into_owned());
    }

    let local_windows = PathBuf::from("ffmpeg/ffmpeg.exe");
    if local_windows.exists() {
        return Ok(local_windows.to_string_lossy().into_owned());
    }

    // Fall back to PATH for developer convenience; release builds should bundle ffmpeg.
    if Command::new("ffmpeg").arg("-version").output().is_ok() {
        return Ok("ffmpeg".to_string());
    }

    Err(AudioError::MissingFfmpeg)
}

pub fn run_enhancement(input_path: &Path, gain_db: f32) -> Result<EnhanceResponse, AudioError> {
    if !input_path.exists() || !input_path.is_file() {
        return Err(AudioError::InvalidInputPath);
    }

    let output_path = build_output_path(input_path)?;
    let ffmpeg = detect_ffmpeg_path()?;
    let gain_filter = format!("dynaudnorm=f=250:g=15,volume={}dB", gain_db);

    let output = Command::new(ffmpeg)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-i")
        .arg(input_path)
        .arg("-af")
        .arg(gain_filter)
        .arg(&output_path)
        .output()
        .map_err(|err| AudioError::ProcessingFailed(err.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(AudioError::ProcessingFailed(stderr));
    }

    Ok(EnhanceResponse {
        output_path: output_path.to_string_lossy().into_owned(),
    })
}
