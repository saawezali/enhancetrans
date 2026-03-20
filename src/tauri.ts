async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const hasTauriBridge = typeof window !== "undefined" && typeof (window as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === "function";

  if (!hasTauriBridge) {
    throw new Error("Tauri bridge is unavailable. Launch the desktop app with 'npm run tauri:dev'.");
  }

  const tauri = await import("@tauri-apps/api/tauri");
  return tauri.invoke<T>(command, args);
}

export interface EnhanceResponse {
  output_path: string;
}

export async function pickAudioFile(): Promise<string | null> {
  const hasTauriBridge = typeof window !== "undefined" && typeof (window as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === "function";

  if (!hasTauriBridge) {
    throw new Error("Tauri bridge is unavailable. Launch the desktop app with 'npm run tauri:dev'.");
  }

  const dialog = await import("@tauri-apps/api/dialog");
  const picked = await dialog.open({
    title: "Choose an audio file",
    multiple: false,
    filters: [
      {
        name: "Audio",
        extensions: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "aiff", "opus", "amr", "alac"]
      }
    ]
  });

  return typeof picked === "string" ? picked : null;
}

export async function enhanceAudio(
  inputPath: string,
  gainDb: number,
  noiseReductionStrength: number,
  noiseProfile: "voice_focused" | "chair_suppress" | "aggressive",
  advancedCleanup: boolean
): Promise<EnhanceResponse> {
  return invokeTauri<EnhanceResponse>("enhance_audio", {
    inputPath,
    gainDb,
    noiseReductionStrength,
    noiseProfile,
    advancedCleanup
  });
}
