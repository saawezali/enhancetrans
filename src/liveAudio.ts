export type LiveNoisePresetKey = "voice_focused" | "chair_suppress" | "aggressive";

export interface LiveEffectSettings {
  gainDb: number;
  vocalBrightness: number;
  maxCombinedNoiseReduction: number;
  advancedCleanup: boolean;
  presetEnabled: Record<LiveNoisePresetKey, boolean>;
  presetStrength: Record<LiveNoisePresetKey, number>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface LiveNodeChain {
  source: MediaStreamAudioSourceNode;
  highpass: BiquadFilterNode;
  mudCut: BiquadFilterNode;
  scrapeCut1: BiquadFilterNode;
  scrapeCut2: BiquadFilterNode;
  hissCut: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  mudRelief: BiquadFilterNode;
  presenceBoost: BiquadFilterNode;
  airBoost: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  outputGain: GainNode;
  monitorGain: GainNode;
  outputDestination: MediaStreamAudioDestinationNode;
}

export class LiveAudioEngine {
  private audioContext: AudioContext | null = null;
  private inputStream: MediaStream | null = null;
  private chain: LiveNodeChain | null = null;
  private outputAudioElement: HTMLAudioElement | null = null;
  private currentOutputDeviceId = "";

  get isRunning(): boolean {
    return Boolean(this.audioContext && this.chain);
  }

  async listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audioinput");
  }

  async listAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audiooutput");
  }

  async start(
    inputDeviceId: string | null,
    outputDeviceId: string | null,
    settings: LiveEffectSettings
  ): Promise<void> {
    await this.stop();

    const constraints: MediaStreamConstraints = {
      audio: {
        channelCount: 1,
        sampleRate: 48000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {})
      },
      video: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const context = new AudioContext({ latencyHint: "interactive" });
    if (context.state === "suspended") {
      await context.resume();
    }

    const source = context.createMediaStreamSource(stream);
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";

    const mudCut = context.createBiquadFilter();
    mudCut.type = "peaking";
    mudCut.frequency.value = 220;
    mudCut.Q.value = 1.2;

    const scrapeCut1 = context.createBiquadFilter();
    scrapeCut1.type = "peaking";
    scrapeCut1.frequency.value = 1850;
    scrapeCut1.Q.value = 1.3;

    const scrapeCut2 = context.createBiquadFilter();
    scrapeCut2.type = "peaking";
    scrapeCut2.frequency.value = 3200;
    scrapeCut2.Q.value = 1.1;

    const hissCut = context.createBiquadFilter();
    hissCut.type = "peaking";
    hissCut.frequency.value = 7200;
    hissCut.Q.value = 0.9;

    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";

    const mudRelief = context.createBiquadFilter();
    mudRelief.type = "peaking";
    mudRelief.frequency.value = 300;
    mudRelief.Q.value = 1.2;

    const presenceBoost = context.createBiquadFilter();
    presenceBoost.type = "peaking";
    presenceBoost.frequency.value = 3600;
    presenceBoost.Q.value = 1.1;

    const airBoost = context.createBiquadFilter();
    airBoost.type = "peaking";
    airBoost.frequency.value = 8200;
    airBoost.Q.value = 0.9;

    const compressor = context.createDynamicsCompressor();
    const outputGain = context.createGain();
    const monitorGain = context.createGain();
    monitorGain.gain.value = 0;
    const outputDestination = context.createMediaStreamDestination();

    source
      .connect(highpass)
      .connect(mudCut)
      .connect(scrapeCut1)
      .connect(scrapeCut2)
      .connect(hissCut)
      .connect(lowpass)
      .connect(mudRelief)
      .connect(presenceBoost)
      .connect(airBoost)
      .connect(compressor)
      .connect(outputGain);

    outputGain.connect(outputDestination);
    outputGain.connect(monitorGain).connect(context.destination);

    const outputAudioElement = new Audio();
    outputAudioElement.autoplay = true;
    outputAudioElement.srcObject = outputDestination.stream;

    if (outputDeviceId) {
      await this.setElementSink(outputAudioElement, outputDeviceId);
      this.currentOutputDeviceId = outputDeviceId;
    }

    await outputAudioElement.play();

    this.audioContext = context;
    this.inputStream = stream;
    this.outputAudioElement = outputAudioElement;
    this.chain = {
      source,
      highpass,
      mudCut,
      scrapeCut1,
      scrapeCut2,
      hissCut,
      lowpass,
      mudRelief,
      presenceBoost,
      airBoost,
      compressor,
      outputGain,
      monitorGain,
      outputDestination
    };

    this.applySettings(settings);
  }

  async setOutputDevice(outputDeviceId: string): Promise<void> {
    this.currentOutputDeviceId = outputDeviceId;
    if (!this.outputAudioElement) {
      return;
    }
    await this.setElementSink(this.outputAudioElement, outputDeviceId);
  }

  getOutputDeviceId(): string {
    return this.currentOutputDeviceId;
  }

  setMonitorEnabled(enabled: boolean): void {
    if (!this.chain) {
      return;
    }
    this.chain.monitorGain.gain.value = enabled ? 1 : 0;
  }

  async stop(): Promise<void> {
    if (this.inputStream) {
      for (const track of this.inputStream.getTracks()) {
        track.stop();
      }
      this.inputStream = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    if (this.outputAudioElement) {
      this.outputAudioElement.pause();
      this.outputAudioElement.srcObject = null;
      this.outputAudioElement = null;
    }

    this.chain = null;
    this.currentOutputDeviceId = "";
  }

  applySettings(settings: LiveEffectSettings): void {
    if (!this.chain) {
      return;
    }

    const blend = this.computeBlendedReduction(settings);

    this.chain.highpass.frequency.value = blend.highpassHz;
    this.chain.mudCut.gain.value = -blend.mudCutDb;
    this.chain.scrapeCut1.gain.value = -blend.scrape1CutDb;
    this.chain.scrapeCut2.gain.value = -blend.scrape2CutDb;
    this.chain.hissCut.gain.value = -blend.hissCutDb;
    this.chain.lowpass.frequency.value = blend.lowpassHz;

    const brightness = clamp(settings.vocalBrightness / 100, 0, 1);
    this.chain.mudRelief.gain.value = -(0.4 + (1.4 * brightness));
    this.chain.presenceBoost.gain.value = 1.5 + (4.5 * brightness);
    this.chain.airBoost.gain.value = 1.0 + (3.5 * brightness);

    if (settings.advancedCleanup) {
      const cleanup = clamp(blend.effectiveStrength / 100, 0, 1);
      this.chain.compressor.threshold.value = -28 - (10 * cleanup);
      this.chain.compressor.knee.value = 20;
      this.chain.compressor.ratio.value = 2 + (3 * cleanup);
      this.chain.compressor.attack.value = 0.004;
      this.chain.compressor.release.value = 0.16;
    } else {
      this.chain.compressor.threshold.value = -8;
      this.chain.compressor.knee.value = 5;
      this.chain.compressor.ratio.value = 1;
      this.chain.compressor.attack.value = 0.003;
      this.chain.compressor.release.value = 0.08;
    }

    this.chain.outputGain.gain.value = Math.pow(10, settings.gainDb / 20);
  }

  private computeBlendedReduction(settings: LiveEffectSettings): {
    highpassHz: number;
    mudCutDb: number;
    scrape1CutDb: number;
    scrape2CutDb: number;
    hissCutDb: number;
    lowpassHz: number;
    effectiveStrength: number;
  } {
    const voiceWeight = settings.presetEnabled.voice_focused
      ? clamp(settings.presetStrength.voice_focused / 100, 0, 1)
      : 0;
    const chairWeight = settings.presetEnabled.chair_suppress
      ? clamp(settings.presetStrength.chair_suppress / 100, 0, 1)
      : 0;
    const aggressiveWeight = settings.presetEnabled.aggressive
      ? clamp(settings.presetStrength.aggressive / 100, 0, 1)
      : 0;

    const requestedSum = voiceWeight + chairWeight + aggressiveWeight;
    if (requestedSum <= 0) {
      return {
        highpassHz: 60,
        mudCutDb: 0,
        scrape1CutDb: 0,
        scrape2CutDb: 0,
        hissCutDb: 0,
        lowpassHz: 20000,
        effectiveStrength: 0
      };
    }

    const cap = clamp(settings.maxCombinedNoiseReduction / 100, 0.2, 1.0);
    const scale = requestedSum > cap ? cap / requestedSum : 1;

    const voice = voiceWeight * scale;
    const chair = chairWeight * scale;
    const aggressive = aggressiveWeight * scale;
    const activeSum = voice + chair + aggressive;

    const highpassHz = ((72 * voice) + (95 * chair) + (120 * aggressive)) / activeSum;
    const mudCutDb = clamp((5.5 * voice) + (2.0 * chair) + (8.0 * aggressive), 0, 10);
    const scrape1CutDb = clamp((1.5 * voice) + (9.0 * chair) + (6.5 * aggressive), 0, 12);
    const scrape2CutDb = clamp((1.0 * voice) + (8.0 * chair) + (7.0 * aggressive), 0, 11.5);
    const hissCutDb = clamp((4.0 * voice) + (5.0 * chair) + (9.0 * aggressive), 0, 12);
    const lowpassHz = clamp(20000 - ((2300 * voice) + (4200 * chair) + (6500 * aggressive)), 12000, 20000);

    return {
      highpassHz: clamp(highpassHz, 60, 140),
      mudCutDb,
      scrape1CutDb,
      scrape2CutDb,
      hissCutDb,
      lowpassHz,
      effectiveStrength: (voice + chair + aggressive) * 100
    };
  }

  private async setElementSink(element: HTMLAudioElement, deviceId: string): Promise<void> {
    const audioWithSink = element as HTMLAudioElement & {
      setSinkId?: (sinkId: string) => Promise<void>;
    };

    if (!audioWithSink.setSinkId) {
      throw new Error(
        "Output device selection is not supported by this runtime. Set your system default output to virtual cable input."
      );
    }

    await audioWithSink.setSinkId(deviceId);
  }
}
