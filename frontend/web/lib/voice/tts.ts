/**
 * Speak tutor replies. Streams MP3 from /api/tts (ElevenLabs or cache), plays
 * MP3 from the OpenAI fallback, and falls back to the browser's own voice.
 * Starting a new utterance cancels the old one. The last clip is kept so
 * "repeat" replays instantly with no API call.
 */

export type Speed = "slow" | "normal" | "fast";
const BROWSER_RATE: Record<Speed, number> = { slow: 0.85, normal: 1, fast: 1.2 };

export interface Spoken {
  text: string;
  audio: Blob | null; // null when the browser voice was used
}

export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  last: Spoken | null = null;
  onStart?: (text: string) => void;
  onEnd?: () => void;

  stop() {
    this.generation++;
    this.abort?.abort();
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio = null;
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  /** Speak text; resolves when playback ends (or is interrupted). */
  async speak(text: string, speed: Speed = "normal"): Promise<void> {
    this.stop();
    const gen = this.generation;
    this.abort = new AbortController();
    this.onStart?.(text);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, speed }),
        signal: this.abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`tts ${res.status}`);
      const type = res.headers.get("content-type") ?? "audio/mpeg";
      const blob = await this.collect(res, type, gen);
      if (gen !== this.generation) return;
      this.last = { text, audio: blob };
      if (!this.audio) await this.playBlob(blob, gen);
      else await this.ended(gen);
    } catch (err) {
      if (gen !== this.generation || (err as Error).name === "AbortError") return;
      this.last = { text, audio: null };
      await this.browserVoice(text, speed, gen);
    } finally {
      if (gen === this.generation) this.onEnd?.();
    }
  }

  /** Replay the last utterance without calling the API. */
  async repeat(speed: Speed = "normal"): Promise<boolean> {
    const last = this.last;
    if (!last) return false;
    this.stop();
    const gen = this.generation;
    this.onStart?.(last.text);
    if (last.audio) await this.playBlob(last.audio, gen);
    else await this.browserVoice(last.text, speed, gen);
    if (gen === this.generation) this.onEnd?.();
    return true;
  }

  /**
   * Read the response. MP3 is played while it streams (MediaSource) so speech
   * starts before the whole clip has arrived; the bytes are kept for repeat.
   */
  private async collect(res: Response, type: string, gen: number): Promise<Blob> {
    const canStream =
      type === "audio/mpeg" && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg");
    if (!canStream) return new Blob([await res.arrayBuffer()], { type });

    const ms = new MediaSource();
    const audio = new Audio(URL.createObjectURL(ms));
    this.audio = audio;
    const chunks: Uint8Array[] = [];
    await new Promise<void>((r) => ms.addEventListener("sourceopen", () => r(), { once: true }));
    const sb = ms.addSourceBuffer("audio/mpeg");
    const append = (chunk: Uint8Array) =>
      new Promise<void>((r) => {
        sb.addEventListener("updateend", () => r(), { once: true });
        sb.appendBuffer(chunk as BufferSource);
      });
    const reader = res.body!.getReader();
    let started = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (gen !== this.generation) return new Blob(chunks as BlobPart[], { type });
      if (done) break;
      chunks.push(value);
      await append(value);
      if (!started) {
        started = true;
        audio.play().catch(() => {});
      }
    }
    if (ms.readyState === "open") ms.endOfStream();
    return new Blob(chunks as BlobPart[], { type });
  }

  private ended(gen: number): Promise<void> {
    const a = this.audio;
    if (!a || a.ended) return Promise.resolve();
    return new Promise((resolve) => {
      a.onended = () => resolve();
      a.onpause = () => gen !== this.generation && resolve();
    });
  }

  private async playBlob(blob: Blob, gen: number) {
    const audio = new Audio(URL.createObjectURL(blob));
    this.audio = audio;
    try {
      await audio.play();
    } catch {
      return;
    }
    await this.ended(gen);
  }

  private browserVoice(text: string, speed: Speed, gen: number): Promise<void> {
    if (typeof speechSynthesis === "undefined") return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = BROWSER_RATE[speed];
      u.onend = u.onerror = () => resolve();
      if (gen === this.generation) speechSynthesis.speak(u);
      else resolve();
    });
  }
}
