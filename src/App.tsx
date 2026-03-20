import { useEffect, useMemo, useRef, useState } from "react";
import { LiveAudioEngine, type LiveEffectSettings } from "./liveAudio";
import { enhanceAudio, pickAudioFile } from "./tauri";

type Status = "idle" | "running" | "success" | "error";
type AppMode = "file" | "live";
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
  const [mode, setMode] = useState<AppMode>("file");
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
  const liveAudioEngineRef = useRef<LiveAudioEngine | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string>("");
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState<string>("");
  const [liveRunning, setLiveRunning] = useState(false);
  const [hearMyself, setHearMyself] = useState(false);
  const [liveErrorMessage, setLiveErrorMessage] = useState<string>("");

  function buildLiveSettings(): LiveEffectSettings {
    return {
      gainDb,
      vocalBrightness,
      maxCombinedNoiseReduction,
      advancedCleanup,
      presetEnabled,
      presetStrength
    };
  }

  async function refreshInputDevices(): Promise<void> {
    try {
      if (!liveAudioEngineRef.current) {
        liveAudioEngineRef.current = new LiveAudioEngine();
      }
      const inputDevices = await liveAudioEngineRef.current.listAudioInputDevices();
      const outputDevices = await liveAudioEngineRef.current.listAudioOutputDevices();

      setAudioInputDevices(inputDevices);
      setAudioOutputDevices(outputDevices);

      if (!selectedInputDeviceId && inputDevices.length > 0) {
        setSelectedInputDeviceId(inputDevices[0].deviceId);
      }
      if (!selectedOutputDeviceId && outputDevices.length > 0) {
        setSelectedOutputDeviceId(outputDevices[0].deviceId);
      }
    } catch (error) {
      setLiveErrorMessage(getErrorMessage(error, "Could not list audio input devices."));
    }
  }

  async function onStartLiveAudio(): Promise<void> {
    try {
      if (!liveAudioEngineRef.current) {
        liveAudioEngineRef.current = new LiveAudioEngine();
      }
      setLiveErrorMessage("");
      await liveAudioEngineRef.current.start(
        selectedInputDeviceId || null,
        selectedOutputDeviceId || null,
        buildLiveSettings()
      );
      liveAudioEngineRef.current.setMonitorEnabled(hearMyself);
      setLiveRunning(true);
      await refreshInputDevices();
    } catch (error) {
      setLiveErrorMessage(getErrorMessage(error, "Could not start live audio processing."));
      setLiveRunning(false);
    }
  }

  async function onStopLiveAudio(): Promise<void> {
    try {
      if (!liveAudioEngineRef.current) {
        return;
      }
      await liveAudioEngineRef.current.stop();
    } finally {
      setLiveRunning(false);
    }
  }

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

  useEffect(() => {
    void refreshInputDevices();
  }, []);

  useEffect(() => {
    if (!liveRunning || !liveAudioEngineRef.current) {
      return;
    }
    liveAudioEngineRef.current.applySettings(buildLiveSettings());
  }, [
    liveRunning,
    gainDb,
    vocalBrightness,
    maxCombinedNoiseReduction,
    advancedCleanup,
    presetEnabled,
    presetStrength
  ]);

  useEffect(() => {
    if (!liveRunning || !liveAudioEngineRef.current || !selectedOutputDeviceId) {
      return;
    }

    void liveAudioEngineRef.current.setOutputDevice(selectedOutputDeviceId).catch((error: unknown) => {
      setLiveErrorMessage(getErrorMessage(error, "Could not switch output device."));
    });
  }, [liveRunning, selectedOutputDeviceId]);

  useEffect(() => {
    if (!liveRunning || !liveAudioEngineRef.current) {
      return;
    }
    liveAudioEngineRef.current.setMonitorEnabled(hearMyself);
  }, [liveRunning, hearMyself]);

  useEffect(() => {
    return () => {
      if (liveAudioEngineRef.current) {
        void liveAudioEngineRef.current.stop();
      }
    };
  }, []);

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
        <p className="subtitle">Offline enhancement + live FX routing</p>

        <div className="mode-tabs" role="tablist" aria-label="Enhance mode">
          <button
            type="button"
            className={`tab-btn ${mode === "file" ? "tab-active" : ""}`}
            onClick={() => setMode("file")}
          >
            File Mode
          </button>
          <button
            type="button"
            className={`tab-btn ${mode === "live" ? "tab-active" : ""}`}
            onClick={() => setMode("live")}
          >
            Live Mode
          </button>
        </div>

        {mode === "file" ? (
          <>
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
          </>
        ) : (
          <>
            <h2 className="subheading">Live Mode</h2>
            <p className="subtitle live-subtitle">
              Capture mic input, apply effects in real time, and route processed signal to a virtual output device.
            </p>

            <div className="slider-wrap">
              <label htmlFor="live-gain">Gain ({gainDb.toFixed(1)} dB)</label>
              <input
                id="live-gain"
                type="range"
                min={-24}
                max={24}
                step={0.5}
                value={gainDb}
                onChange={(event: { target: { value: string } }) => setGainDb(Number(event.target.value))}
              />
            </div>

            <div className="preset-block">
              <p className="preset-heading">Noise Presets (multi-select)</p>

              <div className="slider-wrap">
                <label className="check-row" htmlFor="live-preset-voice-focused">
                  <input
                    id="live-preset-voice-focused"
                    type="checkbox"
                    checked={presetEnabled.voice_focused}
                    onChange={(event: { target: { checked: boolean } }) =>
                      setPresetEnabled((prev) => ({ ...prev, voice_focused: event.target.checked }))
                    }
                  />
                  <span>Voice Focused</span>
                </label>
                <label htmlFor="live-strength-voice-focused">Strength ({presetStrength.voice_focused}%)</label>
                <input
                  id="live-strength-voice-focused"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={presetStrength.voice_focused}
                  onChange={(event: { target: { value: string } }) =>
                    setPresetStrength((prev) => ({ ...prev, voice_focused: Number(event.target.value) }))
                  }
                  disabled={!presetEnabled.voice_focused}
                />
              </div>

              <div className="slider-wrap">
                <label className="check-row" htmlFor="live-preset-chair-suppress">
                  <input
                    id="live-preset-chair-suppress"
                    type="checkbox"
                    checked={presetEnabled.chair_suppress}
                    onChange={(event: { target: { checked: boolean } }) =>
                      setPresetEnabled((prev) => ({ ...prev, chair_suppress: event.target.checked }))
                    }
                  />
                  <span>Chair/Scrape Suppress</span>
                </label>
                <label htmlFor="live-strength-chair-suppress">Strength ({presetStrength.chair_suppress}%)</label>
                <input
                  id="live-strength-chair-suppress"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={presetStrength.chair_suppress}
                  onChange={(event: { target: { value: string } }) =>
                    setPresetStrength((prev) => ({ ...prev, chair_suppress: Number(event.target.value) }))
                  }
                  disabled={!presetEnabled.chair_suppress}
                />
              </div>

              <div className="slider-wrap">
                <label className="check-row" htmlFor="live-preset-aggressive">
                  <input
                    id="live-preset-aggressive"
                    type="checkbox"
                    checked={presetEnabled.aggressive}
                    onChange={(event: { target: { checked: boolean } }) =>
                      setPresetEnabled((prev) => ({ ...prev, aggressive: event.target.checked }))
                    }
                  />
                  <span>Aggressive Cleanup</span>
                </label>
                <label htmlFor="live-strength-aggressive">Strength ({presetStrength.aggressive}%)</label>
                <input
                  id="live-strength-aggressive"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={presetStrength.aggressive}
                  onChange={(event: { target: { value: string } }) =>
                    setPresetStrength((prev) => ({ ...prev, aggressive: Number(event.target.value) }))
                  }
                  disabled={!presetEnabled.aggressive}
                />
              </div>
            </div>

            <div className="slider-wrap">
              <label htmlFor="live-max-noise-cap">Max Combined Noise Reduction ({maxCombinedNoiseReduction}%)</label>
              <input
                id="live-max-noise-cap"
                type="range"
                min={20}
                max={100}
                step={1}
                value={maxCombinedNoiseReduction}
                onChange={(event: { target: { value: string } }) => setMaxCombinedNoiseReduction(Number(event.target.value))}
              />
            </div>

            <div className="slider-wrap">
              <label htmlFor="live-vocal-brightness">Vocal Brightness ({vocalBrightness}%)</label>
              <input
                id="live-vocal-brightness"
                type="range"
                min={0}
                max={100}
                step={1}
                value={vocalBrightness}
                onChange={(event: { target: { value: string } }) => setVocalBrightness(Number(event.target.value))}
              />
            </div>

            <label className="check-row" htmlFor="live-advanced-cleanup">
              <input
                id="live-advanced-cleanup"
                type="checkbox"
                checked={advancedCleanup}
                onChange={(event: { target: { checked: boolean } }) => setAdvancedCleanup(event.target.checked)}
              />
              <span>Advanced Cleanup (live compressor tuning)</span>
            </label>

            <div className="row">
              <button type="button" className="btn" onClick={refreshInputDevices}>
                Refresh Devices
              </button>
              <select
                className="select"
                value={selectedInputDeviceId}
                onChange={(event: { target: { value: string } }) => setSelectedInputDeviceId(event.target.value)}
                disabled={liveRunning}
              >
                {audioInputDevices.length === 0 ? (
                  <option value="">No microphone devices detected</option>
                ) : (
                  audioInputDevices.map((device, index) => (
                    <option key={device.deviceId || `input-${index}`} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="row">
              <span className="path">Output Device</span>
              <select
                className="select"
                value={selectedOutputDeviceId}
                onChange={(event: { target: { value: string } }) => setSelectedOutputDeviceId(event.target.value)}
              >
                {audioOutputDevices.length === 0 ? (
                  <option value="">No output devices detected</option>
                ) : (
                  audioOutputDevices.map((device, index) => (
                    <option key={device.deviceId || `output-${index}`} value={device.deviceId}>
                      {device.label || `Output ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={liveRunning ? onStopLiveAudio : onStartLiveAudio}
            >
              {liveRunning ? "Stop Live FX" : "Start Live FX"}
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => setHearMyself((prev) => !prev)}
              disabled={!liveRunning}
            >
              {hearMyself ? "Mute Self Monitor" : "Hear Myself"}
            </button>

            <p className={`status ${liveRunning ? "status-success" : "status-idle"}`}>
              {liveRunning ? "Live processing is active." : "Live processing is stopped."}
            </p>
            <p className="status status-idle">
              Local self monitor: {hearMyself && liveRunning ? "On" : "Off"}
            </p>
            {liveErrorMessage ? <p className="status status-error">{liveErrorMessage}</p> : null}
            <p className="routing-note">
              For Discord and similar apps: choose your virtual cable INPUT as output device here, then in Discord set
              microphone to the matching virtual cable OUTPUT.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
