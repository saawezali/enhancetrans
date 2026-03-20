# EnhanceTrans

EnhanceTrans is a local web interface desktop app for offline audio enhancement.

## Current implementation

- Local UI with file selection.
- Gain slider from -24 dB to +24 dB.
- Multi-select noise presets with per-preset strength sliders:
  - Voice Focused
  - Chair/Scrape Suppress
  - Aggressive Cleanup
- Max Combined Noise Reduction slider (safety cap for overlap protection).
- Vocal Brightness slider for muffled speech/audio.
- Advanced Cleanup toggle that adds spectral denoise and a gentle gate.
- Local processing command that runs FFmpeg with a staged filter chain.
- Output saved in the same folder with default prefix `enhanced_`.
- Completion cue sound on successful enhancement.

### Processing pipeline

EnhanceTrans currently applies filters in this order:

1. Dynamic normalization (`dynaudnorm`)
2. Optional advanced cleanup (`afftdn` + `agate`) when enabled
3. Weighted multi-preset EQ noise reduction (strength-scaled and cap-limited)
4. Optional vocal-brightness EQ (presence + air boost with mild low-mid relief)
5. Gain adjustment (`volume`)

This design keeps speech intelligibility as the primary goal while reducing hiss, rumble, and intermittent mechanical noise.

### Suggested settings

- General voice:
	- Voice Focused strength: 30-45%
	- Max Combined Noise Reduction: 70-80%
	- Vocal Brightness: 20-35%
- Chair noise and desk movement:
	- Voice Focused: 20-35%
	- Chair/Scrape Suppress: 35-55%
	- Max Combined Noise Reduction: 75-90%
	- Vocal Brightness: 25-40%
- Very noisy recordings:
	- Voice Focused: 20-35%
	- Aggressive Cleanup: 35-60%
	- Max Combined Noise Reduction: 85-100%
	- Vocal Brightness: 30-45%

If voice becomes harsh or thin, reduce Vocal Brightness by 5-10% and/or lower Aggressive Cleanup strength.

## Requirements

- Node.js 20+
- Rust 1.77+
- FFmpeg binary

For development, FFmpeg can be available on PATH.
For release packaging, include a bundled binary at:

- `ffmpeg/ffmpeg` (Linux/macOS)
- `ffmpeg/ffmpeg.exe` (Windows)

## Run in development

1. Install dependencies:

```bash
npm install
```

2. Start app:

```bash
npm run tauri:dev
```

On first run, if `dist/` does not exist yet, the dev script will automatically run `npm run build` once before launching Tauri.

## Build distributable

```bash
npm run tauri:build
```

This produces bundled artifacts in `src-tauri/target/release/bundle`.

## Notes

- "All formats" means broad practical support based on FFmpeg capabilities.
- On processing failure, the app surfaces FFmpeg error output.
- Advanced Cleanup can reduce transient and room noise further, but very high settings may remove some high-frequency speech detail.
- Enabling multiple presets is safe because strengths are blended and capped by the Max Combined Noise Reduction slider.
