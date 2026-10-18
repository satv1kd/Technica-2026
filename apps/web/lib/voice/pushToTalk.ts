/** Record the microphone while the space bar is held. */

export const MIN_HOLD_MS = 250;

export class PushToTalk {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  /** Ask for the mic once; later presses start instantly. */
  async ensureMic(): Promise<boolean> {
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      return true;
    } catch {
      return false;
    }
  }

  async start(): Promise<boolean> {
    if (this.recorder?.state === "recording") return true;
    if (!(await this.ensureMic())) return false;
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream!, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
    this.startedAt = performance.now();
    return true;
  }

  /** Stop and return the clip, or null if the hold was too short. */
  stop(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec || rec.state !== "recording") return Promise.resolve(null);
    const held = performance.now() - this.startedAt;
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" });
        resolve(held >= MIN_HOLD_MS && blob.size > 0 ? blob : null);
      };
      rec.stop();
    });
  }

  cancel() {
    if (this.recorder?.state === "recording") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.chunks = [];
  }
}

export interface SttResult {
  ok: boolean;
  text: string;
  confidence: number;
  message?: string;
}

export async function transcribe(blob: Blob): Promise<SttResult> {
  const form = new FormData();
  form.append("audio", blob, "speech.webm");
  try {
    const res = await fetch("/api/stt", { method: "POST", body: form });
    return await res.json();
  } catch {
    return { ok: false, text: "", confidence: 0, message: "I didn't catch that, try again." };
  }
}
