# EnhanceTrans

EnhanceTrans is a local web interface desktop app for offline audio enhancement.

## Current implementation

- Separate File Mode and Live Mode views.
- File Mode for offline file enhancement and export.
- Live Mode for real-time microphone processing and routing.
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

### Live mode

Live mode captures microphone input and applies the current effect settings in real time.

- Uses low-latency Web Audio processing inside the app
- Reuses the same preset blending, safety cap, brightness, and gain controls
- Includes live microphone input selection, output-device selection, and start/stop control

Important:

- To make Discord and similar apps detect processed audio as a microphone, you must use a virtual audio cable device (for example VB-CABLE).
- In Live Mode, choose the virtual cable INPUT as the app output device.
- Then in Discord (or another app), select the matching virtual cable OUTPUT as microphone input.
- Without a virtual cable driver, apps will not detect the processed stream as a standalone mic device.

### Discord routing (Windows)

1. Install a virtual audio cable (for example VB-CABLE).
2. Open EnhanceTrans Live Mode and select your microphone input device.
3. In EnhanceTrans Live Mode, select the virtual cable INPUT as output device.
4. Start Live FX.
5. In Discord voice settings, choose the matching virtual cable OUTPUT as microphone input.
6. Keep EnhanceTrans running while speaking.

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
