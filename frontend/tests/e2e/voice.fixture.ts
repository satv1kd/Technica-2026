import type { Page } from "@playwright/test";

/** Deterministic capture and playback; no microphone permission or paid APIs. */
export async function installVoiceMocks(page: Page) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  // Never spend ElevenLabs quota in tests; specs that inspect TTS add their own route (later routes win).
  await page.route("**/api/tts", (route) => route.fulfill({ contentType: "audio/wav", body: "test audio" }));
  await page.addInitScript(() => {
    const state = { recordings: 0, tracksStopped: 0, played: 0, spoken: [] as string[] };
    (window as any).__voice = state;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { state.tracksStopped++; } }] }) },
    });
    class Recorder {
      static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
      state = "inactive";
      mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; state.recordings++; }
      stop() {
        this.state = "inactive";
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(["test speech"]) });
          this.onstop?.();
        }, 0);
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
    // Exercise the fully buffered fallback here; streaming has a controlled unit test.
    Object.defineProperty(window, "MediaSource", { configurable: true, value: undefined });
    class Audio extends EventTarget {
      constructor(public src: string) { super(); }
      async play() {
        state.played++;
        setTimeout(() => this.dispatchEvent(new Event("ended")), 20);
      }
      pause() {}
      removeAttribute() {}
      load() {}
    }
    Object.defineProperty(window, "Audio", { configurable: true, value: Audio });
    // A recording Web Audio stand-in: chart tones set frequency.value directly
    // (earcons glide with setValueAtTime), so tests can tell them apart.
    const audio = { tones: [] as { freq: number; wave: string }[], stops: 0 };
    (window as any).__audio = audio;
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
    class FakeAudioContext {
      state = "running";
      sampleRate = 44100;
      destination = {};
      get currentTime() { return performance.now() / 1000; }
      resume() { return Promise.resolve(); }
      createGain() { return { gain: param(), connect: (n: any) => n }; }
      createBiquadFilter() { return { type: "", frequency: param(), connect: (n: any) => n }; }
      createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
      createBufferSource() { return { buffer: null, connect: (n: any) => n, start() {}, stop() { audio.stops++; } }; }
      createOscillator() {
        const freq = { ...param() } as any;
        let v = 0;
        const osc: any = { type: "sine", connect: (n: any) => n, start() {}, stop() { audio.stops++; } };
        Object.defineProperty(freq, "value", {
          get: () => v,
          set: (x: number) => { v = x; audio.tones.push({ freq: x, wave: osc.type }); },
        });
        osc.frequency = freq;
        return osc;
      }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance: SpeechSynthesisUtterance) {
          state.spoken.push(utterance.text);
          setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), 0);
        },
      },
    });
  });
}
