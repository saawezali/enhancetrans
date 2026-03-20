import { useMemo, useRef, useState } from "react";
import { enhanceAudio, pickAudioFile } from "./tauri";

type Status = "idle" | "running" | "success" | "error";
type NoisePresetKey = "voice_focused" | "chair_suppress" | "aggressive";
type PresetSelectionState = Record<NoisePresetKey, boolean>;
type PresetStrengthState = Record<NoisePresetKey, number>;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

function playCompletionCue(context: AudioContext): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.26);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.28);
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [gainDb, setGainDb] = useState(0);
  const [presetEnabled, setPresetEnabled] = useState<PresetSelectionState>({
    voice_focused: true,
    chair_suppress: false,
    aggressive: false
  });
  const [presetStrength, setPresetStrength] = useState<PresetStrengthState>({
    voice_focused: 40,
    chair_suppress: 35,
    aggressive: 25
  });
  const [maxCombinedNoiseReduction, setMaxCombinedNoiseReduction] = useState(80);
  const [vocalBrightness, setVocalBrightness] = useState(30);
  const [advancedCleanup, setAdvancedCleanup] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [resultPath, setResultPath] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const completionAudioContextRef = useRef<AudioContext | null>(null);

  async function ensureCompletionAudioContext(): Promise<AudioContext | null> {
    try {
      const existing = completionAudioContextRef.current;
      const context = existing && existing.state !== "closed" ? existing : new AudioContext();
      completionAudioContextRef.current = context;

      // Resume during user interaction so playback remains allowed after async work finishes.
      if (context.state === "suspended") {
        await context.resume();
      }

      return context;
    } catch {
      return null;
    }
  }

  const statusMessage = useMemo(() => {
    if (status === "running") {
      return "Enhancing audio locally...";
    }
    if (status === "success") {
      return `Done. Saved to: ${resultPath}`;
    }
    if (status === "error") {
      return errorMessage || "Enhancement failed.";
    }
    return "Select an audio file to begin.";
  }, [status, resultPath, errorMessage]);

  const canEnhance = Boolean(selectedFile) && status !== "running";

  async function onPickFile(): Promise<void> {
    try {
      const filePath = await pickAudioFile();
      if (!filePath) {
        return;
      }
      setSelectedFile(filePath);
      setStatus("idle");
      setResultPath("");
      setErrorMessage("");
    } catch (error) {
      setStatus("error");
      setErrorMessage(getErrorMessage(error, "Could not open file picker."));
    }
  }

  async function onEnhance(): Promise<void> {
    if (!selectedFile) {
      return;
    }

    await ensureCompletionAudioContext();

    setStatus("running");
    setResultPath("");
    setErrorMessage("");

    try {
      const result = await enhanceAudio(
        selectedFile,
        gainDb,
        presetEnabled.voice_focused,
        presetStrength.voice_focused,
        presetEnabled.chair_suppress,
        presetStrength.chair_suppress,
        presetEnabled.aggressive,
        presetStrength.aggressive,
        maxCombinedNoiseReduction,
        vocalBrightness,
        advancedCleanup
      );
      setResultPath(result.output_path);
      setStatus("success");
      const cueContext = completionAudioContextRef.current;
      if (cueContext) {
        playCompletionCue(cueContext);
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(getErrorMessage(error, "Enhancement failed."));
    }
  }

  return (
    <main className="shell">
      <section className="card">
        <h1>EnhanceTrans</h1>
        <p className="subtitle">please work ffs</p>

        <div className="row">
          <button type="button" className="btn" onClick={onPickFile} disabled={status === "running"}>
            Select Audio File
          </button>
          <span className="path">{selectedFile ?? "No file selected"}</span>
        </div>

        <div className="slider-wrap">
          <label htmlFor="gain">Gain ({gainDb.toFixed(1)} dB)</label>
          <input
            id="gain"
            type="range"
            min={-24}
            max={24}
            step={0.5}
            value={gainDb}
            onChange={(event: { target: { value: string } }) => setGainDb(Number(event.target.value))}
            disabled={status === "running"}
          />
        </div>

        <div className="preset-block">
          <p className="preset-heading">Noise Presets (multi-select)</p>

          <div className="slider-wrap">
            <label className="check-row" htmlFor="preset-voice-focused">
              <input
                id="preset-voice-focused"
                type="checkbox"
                checked={presetEnabled.voice_focused}
                onChange={(event: { target: { checked: boolean } }) =>
                  setPresetEnabled((prev) => ({ ...prev, voice_focused: event.target.checked }))
                }
                disabled={status === "running"}
              />
              <span>Voice Focused</span>
            </label>
            <label htmlFor="strength-voice-focused">Strength ({presetStrength.voice_focused}%)</label>
            <input
              id="strength-voice-focused"
              type="range"
              min={0}
              max={100}
              step={1}
              value={presetStrength.voice_focused}
              onChange={(event: { target: { value: string } }) =>
                setPresetStrength((prev) => ({ ...prev, voice_focused: Number(event.target.value) }))
              }
              disabled={status === "running" || !presetEnabled.voice_focused}
            />
          </div>

          <div className="slider-wrap">
            <label className="check-row" htmlFor="preset-chair-suppress">
              <input
                id="preset-chair-suppress"
                type="checkbox"
                checked={presetEnabled.chair_suppress}
                onChange={(event: { target: { checked: boolean } }) =>
                  setPresetEnabled((prev) => ({ ...prev, chair_suppress: event.target.checked }))
                }
                disabled={status === "running"}
              />
              <span>Chair/Scrape Suppress</span>
            </label>
            <label htmlFor="strength-chair-suppress">Strength ({presetStrength.chair_suppress}%)</label>
            <input
              id="strength-chair-suppress"
              type="range"
              min={0}
              max={100}
              step={1}
              value={presetStrength.chair_suppress}
              onChange={(event: { target: { value: string } }) =>
                setPresetStrength((prev) => ({ ...prev, chair_suppress: Number(event.target.value) }))
              }
              disabled={status === "running" || !presetEnabled.chair_suppress}
            />
          </div>

          <div className="slider-wrap">
            <label className="check-row" htmlFor="preset-aggressive">
              <input
                id="preset-aggressive"
                type="checkbox"
                checked={presetEnabled.aggressive}
                onChange={(event: { target: { checked: boolean } }) =>
                  setPresetEnabled((prev) => ({ ...prev, aggressive: event.target.checked }))
                }
                disabled={status === "running"}
              />
              <span>Aggressive Cleanup</span>
            </label>
            <label htmlFor="strength-aggressive">Strength ({presetStrength.aggressive}%)</label>
            <input
              id="strength-aggressive"
              type="range"
              min={0}
              max={100}
              step={1}
              value={presetStrength.aggressive}
              onChange={(event: { target: { value: string } }) =>
                setPresetStrength((prev) => ({ ...prev, aggressive: Number(event.target.value) }))
              }
              disabled={status === "running" || !presetEnabled.aggressive}
            />
          </div>
        </div>

        <div className="slider-wrap">
          <label htmlFor="max-noise-cap">Max Combined Noise Reduction ({maxCombinedNoiseReduction}%)</label>
          <input
            id="max-noise-cap"
            type="range"
            min={20}
            max={100}
            step={1}
            value={maxCombinedNoiseReduction}
            onChange={(event: { target: { value: string } }) => setMaxCombinedNoiseReduction(Number(event.target.value))}
            disabled={status === "running"}
          />
        </div>

        <div className="slider-wrap">
          <label htmlFor="vocal-brightness">Vocal Brightness ({vocalBrightness}%)</label>
          <input
            id="vocal-brightness"
            type="range"
            min={0}
            max={100}
            step={1}
            value={vocalBrightness}
            onChange={(event: { target: { value: string } }) => setVocalBrightness(Number(event.target.value))}
            disabled={status === "running"}
          />
        </div>

        <label className="check-row" htmlFor="advanced-cleanup">
          <input
            id="advanced-cleanup"
            type="checkbox"
            checked={advancedCleanup}
            onChange={(event: { target: { checked: boolean } }) => setAdvancedCleanup(event.target.checked)}
            disabled={status === "running"}
          />
          <span>Advanced Cleanup (spectral denoise + gentle gate)</span>
        </label>

        <button type="button" className="btn btn-primary" onClick={onEnhance} disabled={!canEnhance}>
          {status === "running" ? "Enhancing..." : "Enhance & Save"}
        </button>

        <p className={`status status-${status}`}>{statusMessage}</p>
      </section>
    </main>
  );
}
