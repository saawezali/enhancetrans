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

fn build_noise_reduction_eq_filter(
    noise_reduction_strength: f32,
    noise_profile: &str,
) -> Option<String> {
    let normalized = (noise_reduction_strength / 100.0).clamp(0.0, 1.0);
    if normalized <= 0.0 {
        return None;
    }

    let filter = match noise_profile {
        "chair_suppress" => {
            let rumble_hz = 80.0 + (40.0 * normalized);
            let scrape_cut_db = 5.0 + (9.0 * normalized);
            let squeak_cut_db = 4.0 + (8.0 * normalized);
            let hiss_cut_db = 3.0 + (5.0 * normalized);
            format!(
                "highpass=f={:.0},equalizer=f=1800:t=q:w=1.4:g=-{:.2},equalizer=f=3200:t=q:w=1.2:g=-{:.2},equalizer=f=7600:t=q:w=0.8:g=-{:.2}",
                rumble_hz, scrape_cut_db, squeak_cut_db, hiss_cut_db
            )
        }
        "aggressive" => {
            let rumble_hz = 90.0 + (45.0 * normalized);
            let mud_cut_db = 6.0 + (10.0 * normalized);
            let scrape_cut_db = 4.0 + (9.0 * normalized);
            let hiss_cut_db = 5.0 + (11.0 * normalized);
            let lowpass_hz = 18500.0 - (8500.0 * normalized);
            format!(
                "highpass=f={:.0},equalizer=f=230:t=q:w=1.4:g=-{:.2},equalizer=f=2600:t=q:w=1.0:g=-{:.2},equalizer=f=7200:t=q:w=0.9:g=-{:.2},lowpass=f={:.0}",
                rumble_hz, mud_cut_db, scrape_cut_db, hiss_cut_db, lowpass_hz
            )
        }
        _ => {
            let rumble_hz = 65.0 + (25.0 * normalized);
            let mud_cut_db = 3.0 + (7.0 * normalized);
            let hiss_cut_db = 2.0 + (6.0 * normalized);
            let lowpass_hz = 19500.0 - (5500.0 * normalized);
            format!(
                "highpass=f={:.0},equalizer=f=220:t=q:w=1.2:g=-{:.2},equalizer=f=6800:t=q:w=0.9:g=-{:.2},lowpass=f={:.0}",
                rumble_hz, mud_cut_db, hiss_cut_db, lowpass_hz
            )
        }
    };

    Some(filter)
}

fn build_advanced_cleanup_filter(noise_reduction_strength: f32) -> Option<String> {
    let normalized = (noise_reduction_strength / 100.0).clamp(0.0, 1.0);
    if normalized <= 0.0 {
        return None;
    }

    let spectral_nr = 6.0 + (16.0 * normalized);
    let noise_floor = -42.0 + (8.0 * normalized);
    let gate_threshold = 0.012 + (0.01 * normalized);
    let gate_ratio = 1.1 + (0.7 * normalized);

    Some(format!(
        "afftdn=nr={:.1}:nf={:.1}:tn=1,agate=mode=downward:threshold={:.4}:ratio={:.2}:attack=15:release=250",
        spectral_nr, noise_floor, gate_threshold, gate_ratio
    ))
}

pub fn run_enhancement(
    input_path: &Path,
    gain_db: f32,
    noise_reduction_strength: f32,
    noise_profile: &str,
    advanced_cleanup: bool,
) -> Result<EnhanceResponse, AudioError> {
    if !input_path.exists() || !input_path.is_file() {
        return Err(AudioError::InvalidInputPath);
    }

    let output_path = build_output_path(input_path)?;
    let ffmpeg = detect_ffmpeg_path()?;
    let mut filters = vec!["dynaudnorm=f=250:g=15".to_string()];

    if advanced_cleanup {
        if let Some(advanced_filter) = build_advanced_cleanup_filter(noise_reduction_strength) {
            filters.push(advanced_filter);
        }
    }

    if let Some(noise_eq_filter) =
        build_noise_reduction_eq_filter(noise_reduction_strength, noise_profile)
    {
        filters.push(noise_eq_filter);
    }

    filters.push(format!("volume={}dB", gain_db));
    let full_filter_chain = filters.join(",");

    let output = Command::new(ffmpeg)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-i")
        .arg(input_path)
        .arg("-af")
        .arg(full_filter_chain)
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
