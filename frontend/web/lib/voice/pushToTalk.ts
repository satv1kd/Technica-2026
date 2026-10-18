/** Record only while held; late permission grants must never open a recording. */
export { MIN_HOLD_MS } from "../state/appMachine";
import { MIN_HOLD_MS } from "../state/appMachine";

export class PushToTalk {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private generation = 0;
  private startedAt = 0;
  private finish: ((clip: Blob | null) => void) | null = null;

  async start(): Promise<boolean> {
    this.cancel();
    const gen = this.generation;
    try {
      if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (gen !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.stream = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
        .find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      this.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (gen === this.generation && event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const clip = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        this.finish?.(gen === this.generation && clip.size ? clip : null);
        this.finish = null;
        stream.getTracks().forEach((track) => track.stop());
        if (this.recorder === recorder) {
          this.recorder = null;
          this.stream = null;
        }
      };
      recorder.onerror = () => this.cancel();
      recorder.start();
      this.startedAt = performance.now();
      return true;
    } catch {
      if (gen === this.generation) this.cancel();
      return false;
    }
  }

  stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== "recording" || performance.now() - this.startedAt < MIN_HOLD_MS) {
      this.cancel();
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this.finish = resolve;
      recorder.stop();
    });
  }

  cancel() {
    this.generation++;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    this.finish?.(null);
    this.finish = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
