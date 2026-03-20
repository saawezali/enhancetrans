# EnhanceTrans

EnhanceTrans is a local web interface desktop app for offline audio enhancement.

## Current implementation

- Local UI with file selection.
- Gain slider from -24 dB to +24 dB.
- Noise Reduction slider from 0% to 100%.
- Noise Profile selector:
	- Voice Focused
	- Chair/Scrape Suppress
	- Aggressive Cleanup
- Advanced Cleanup toggle that adds spectral denoise and a gentle gate.
- Local processing command that runs FFmpeg with a staged filter chain.
- Output saved in the same folder with default prefix `enhanced_`.
- Completion cue sound on successful enhancement.

### Processing pipeline

EnhanceTrans currently applies filters in this order:

1. Dynamic normalization (`dynaudnorm`)
2. Optional advanced cleanup (`afftdn` + `agate`) when enabled
3. Preset-based EQ noise reduction (strength-scaled)
4. Gain adjustment (`volume`)

This design keeps speech intelligibility as the primary goal while reducing hiss, rumble, and intermittent mechanical noise.

### Suggested settings

- General voice: `Voice Focused` with noise reduction around 25-45%
- Chair noise and desk movement: `Chair/Scrape Suppress` with noise reduction around 35-55%
- Very noisy recordings: `Aggressive Cleanup` with noise reduction around 45-65%

If voice becomes dull, reduce Noise Reduction by 5-10% before increasing gain.

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
