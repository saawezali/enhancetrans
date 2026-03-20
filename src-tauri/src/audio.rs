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
    voice_focused_enabled: bool,
    voice_focused_strength: f32,
    chair_suppress_enabled: bool,
    chair_suppress_strength: f32,
    aggressive_enabled: bool,
    aggressive_strength: f32,
    max_combined_noise_reduction: f32,
) -> Option<String> {
    let voice_weight = if voice_focused_enabled {
        (voice_focused_strength / 100.0).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let chair_weight = if chair_suppress_enabled {
        (chair_suppress_strength / 100.0).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let aggressive_weight = if aggressive_enabled {
        (aggressive_strength / 100.0).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let requested_sum = voice_weight + chair_weight + aggressive_weight;
    if requested_sum <= 0.0 {
        return None;
    }

    let cap = (max_combined_noise_reduction / 100.0).clamp(0.2, 1.0);
    let scale = if requested_sum > cap {
        cap / requested_sum
    } else {
        1.0
    };

    let voice = voice_weight * scale;
    let chair = chair_weight * scale;
    let aggressive = aggressive_weight * scale;
    let active_sum = voice + chair + aggressive;
    if active_sum <= 0.0 {
        return None;
    }

    // Preset overlap protection: clamp total cuts to keep voice intelligibility.
    let highpass_hz = (72.0 * voice + 95.0 * chair + 120.0 * aggressive) / active_sum;
    let mud_cut_db = (5.5 * voice + 2.0 * chair + 8.0 * aggressive).clamp(0.0, 10.0);
    let scrape_1_cut_db = (1.5 * voice + 9.0 * chair + 6.5 * aggressive).clamp(0.0, 12.0);
    let scrape_2_cut_db = (1.0 * voice + 8.0 * chair + 7.0 * aggressive).clamp(0.0, 11.5);
    let hiss_cut_db = (4.0 * voice + 5.0 * chair + 9.0 * aggressive).clamp(0.0, 12.0);
    let lowpass_hz = 20000.0 - ((2300.0 * voice) + (4200.0 * chair) + (6500.0 * aggressive));

    let filter = format!(
        "highpass=f={:.0},equalizer=f=220:t=q:w=1.2:g=-{:.2},equalizer=f=1850:t=q:w=1.3:g=-{:.2},equalizer=f=3200:t=q:w=1.1:g=-{:.2},equalizer=f=7200:t=q:w=0.9:g=-{:.2},lowpass=f={:.0}",
        highpass_hz.clamp(60.0, 140.0),
        mud_cut_db,
        scrape_1_cut_db,
        scrape_2_cut_db,
        hiss_cut_db,
        lowpass_hz.clamp(12000.0, 20000.0)
    );

    Some(filter)
}

fn build_advanced_cleanup_filter(effective_noise_strength: f32) -> Option<String> {
    let normalized = (effective_noise_strength / 100.0).clamp(0.0, 1.0);
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

fn build_vocal_brightness_filter(vocal_brightness: f32) -> Option<String> {
    let normalized = (vocal_brightness / 100.0).clamp(0.0, 1.0);
    if normalized <= 0.0 {
        return None;
    }

    let presence_boost_db = 1.5 + (4.5 * normalized);
    let air_boost_db = 1.0 + (3.5 * normalized);
    let mud_relief_db = 0.4 + (1.4 * normalized);

    Some(format!(
        "equalizer=f=300:t=q:w=1.2:g=-{:.2},equalizer=f=3600:t=q:w=1.1:g={:.2},equalizer=f=8200:t=q:w=0.9:g={:.2}",
        mud_relief_db, presence_boost_db, air_boost_db
    ))
}

pub fn run_enhancement(
    input_path: &Path,
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
) -> Result<EnhanceResponse, AudioError> {
    if !input_path.exists() || !input_path.is_file() {
        return Err(AudioError::InvalidInputPath);
    }

    let output_path = build_output_path(input_path)?;
    let ffmpeg = detect_ffmpeg_path()?;
    let mut filters = vec!["dynaudnorm=f=250:g=15".to_string()];

    let effective_noise_strength = if voice_focused_enabled || chair_suppress_enabled || aggressive_enabled {
        let requested_sum =
            if voice_focused_enabled { voice_focused_strength.max(0.0) } else { 0.0 }
            + if chair_suppress_enabled { chair_suppress_strength.max(0.0) } else { 0.0 }
            + if aggressive_enabled { aggressive_strength.max(0.0) } else { 0.0 };
        requested_sum.min(max_combined_noise_reduction.clamp(20.0, 100.0))
    } else {
        0.0
    };

    if advanced_cleanup {
        if let Some(advanced_filter) = build_advanced_cleanup_filter(effective_noise_strength) {
            filters.push(advanced_filter);
        }
    }

    if let Some(noise_eq_filter) =
        build_noise_reduction_eq_filter(
            voice_focused_enabled,
            voice_focused_strength,
            chair_suppress_enabled,
            chair_suppress_strength,
            aggressive_enabled,
            aggressive_strength,
            max_combined_noise_reduction,
        )
    {
        filters.push(noise_eq_filter);
    }

    if let Some(brightness_filter) = build_vocal_brightness_filter(vocal_brightness) {
        filters.push(brightness_filter);
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
