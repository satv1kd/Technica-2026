/** Streaming tutor speech, with an in-memory clip for instant repeat. */
export type Speed = "slow" | "normal" | "fast";
const BROWSER_RATE: Record<Speed, number> = { slow: 0.85, normal: 1, fast: 1.2 };
export interface Spoken { text: string; audio: Blob | null }

/** Every event wait also ends on cancellation or a media error. */
function waitFor(target: EventTarget, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, done);
      target.removeEventListener("error", fail);
      signal.removeEventListener("abort", abort);
    };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("Audio playback failed")); };
    const abort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    if (signal.aborted) return abort();
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", fail, { once: true });
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private abort: AbortController | null = null;
  last: Spoken | null = null;
  onStart?: (text: string) => void;
  onEnd?: () => void;

  private releaseAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  stop() {
    this.abort?.abort();
    this.releaseAudio();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  private begin(text: string) {
    this.stop();
    this.abort = new AbortController();
    this.onStart?.(text);
    return this.abort.signal;
  }

  async speak(text: string, speed: Speed = "normal"): Promise<void> {
    const signal = this.begin(text);
    this.last = { text, audio: null };
    try {
      const response = await fetch("/api/tts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, speed }), signal,
      });
      signal.throwIfAborted();
      if (!response.ok || !response.body) throw new Error(`tts ${response.status}`);
      const type = (response.headers.get("content-type") ?? "audio/mpeg").split(";")[0].trim();
      if (type === "audio/mpeg" && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type)) {
        await this.stream(response, type, text, signal);
      } else {
        const blob = await response.blob();
        signal.throwIfAborted();
        if (!blob.size) throw new Error("Empty speech");
        this.last = { text, audio: blob };
        await this.playBlob(blob, signal);
      }
    } catch {
      if (signal.aborted) return;
      this.releaseAudio();
      this.last = { text, audio: null };
      await this.browserVoice(text, speed, signal);
    } finally {
      if (!signal.aborted) {
        this.releaseAudio();
        this.onEnd?.();
      }
    }
  }

  async repeat(speed: Speed = "normal"): Promise<boolean> {
    const last = this.last;
    if (!last) return false;
    const signal = this.begin(last.text);
    try {
      if (last.audio) await this.playBlob(last.audio, signal);
      else await this.browserVoice(last.text, speed, signal);
    } catch {
      if (!signal.aborted) {
        this.releaseAudio();
        await this.browserVoice(last.text, speed, signal);
      }
    } finally {
      if (!signal.aborted) {
        this.releaseAudio();
        this.onEnd?.();
      }
    }
    return true;
  }

  private makeAudio(source: Blob | MediaSource) {
    this.url = URL.createObjectURL(source);
    this.audio = new Audio(this.url);
    return this.audio;
  }

  private async playBlob(blob: Blob, signal: AbortSignal) {
    signal.throwIfAborted();
    const audio = this.makeAudio(blob);
    const ended = waitFor(audio, "ended", signal);
    // Attach rejection handling before play() can fail or be interrupted.
    await Promise.all([ended, audio.play()]);
  }

  private async stream(response: Response, type: string, text: string, signal: AbortSignal) {
    const source = new MediaSource();
    const opened = waitFor(source, "sourceopen", signal);
    const audio = this.makeAudio(source);
    const ended = waitFor(audio, "ended", signal);
    void ended.catch(() => {});
    await opened;
    signal.throwIfAborted();
    const buffer = source.addSourceBuffer(type);
    const reader = response.body!.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let playback: Promise<void> | null = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        chunks.push(value);
        const appended = waitFor(buffer, "updateend", signal);
        buffer.appendBuffer(value as BufferSource);
        await appended;
        if (!playback) {
          playback = Promise.all([audio.play(), ended]).then(() => {});
          void playback.catch(() => {});
        }
      }
      if (!chunks.length) throw new Error("Empty speech");
      if (source.readyState === "open") source.endOfStream();
      this.last = { text, audio: new Blob(chunks as BlobPart[], { type }) };
      await playback;
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  private browserVoice(text: string, speed: Speed, signal: AbortSignal): Promise<void> {
    if (typeof speechSynthesis === "undefined" || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const done = () => {
        signal.removeEventListener("abort", done);
        utterance.onend = utterance.onerror = null;
        resolve();
      };
      utterance.rate = BROWSER_RATE[speed];
      utterance.onend = utterance.onerror = done;
      signal.addEventListener("abort", done, { once: true });
      speechSynthesis.speak(utterance);
    });
  }
}
