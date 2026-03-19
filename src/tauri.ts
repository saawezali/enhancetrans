import { invoke } from "@tauri-apps/api/tauri";

export interface EnhanceResponse {
  output_path: string;
}

export async function pickAudioFile(): Promise<string | null> {
  return invoke<string | null>("pick_audio_file");
}

export async function enhanceAudio(inputPath: string, gainDb: number): Promise<EnhanceResponse> {
  return invoke<EnhanceResponse>("enhance_audio", {
    inputPath,
    gainDb
  });
}
