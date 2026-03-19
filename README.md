# EnhanceTrans

EnhanceTrans is a local web interface desktop app for offline audio enhancement.

## Current implementation

- Local UI with file selection.
- Gain slider from -24 dB to +24 dB.
- Local processing command that runs FFmpeg with a normalization + gain filter.
- Output saved in the same folder with default prefix `enhanced_`.
- Completion cue sound on successful enhancement.

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

## Build distributable

```bash
npm run tauri:build
```

This produces bundled artifacts in `src-tauri/target/release/bundle`.

## Notes

- "All formats" means broad practical support based on FFmpeg capabilities.
- On processing failure, the app surfaces FFmpeg error output.
