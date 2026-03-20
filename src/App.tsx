import { useMemo, useRef, useState } from "react";
import { enhanceAudio, pickAudioFile } from "./tauri";

type Status = "idle" | "running" | "success" | "error";
type NoisePreset = "voice_focused" | "chair_suppress" | "aggressive";

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
  const [noiseReductionStrength, setNoiseReductionStrength] = useState(35);
  const [noisePreset, setNoisePreset] = useState<NoisePreset>("voice_focused");
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
        noiseReductionStrength,
        noisePreset,
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

        <div className="slider-wrap">
          <label htmlFor="noise-reduction">Noise Reduction ({noiseReductionStrength}%)</label>
          <input
            id="noise-reduction"
            type="range"
            min={0}
            max={100}
            step={1}
            value={noiseReductionStrength}
            onChange={(event: { target: { value: string } }) => setNoiseReductionStrength(Number(event.target.value))}
            disabled={status === "running"}
          />
        </div>

        <div className="slider-wrap">
          <label htmlFor="noise-preset">Noise Profile</label>
          <select
            id="noise-preset"
            className="select"
            value={noisePreset}
            onChange={(event: { target: { value: string } }) => setNoisePreset(event.target.value as NoisePreset)}
            disabled={status === "running"}
          >
            <option value="voice_focused">Voice Focused</option>
            <option value="chair_suppress">Chair/Scrape Suppress</option>
            <option value="aggressive">Aggressive Cleanup</option>
          </select>
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
