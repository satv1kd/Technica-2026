import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushToTalk } from "@web/lib/voice/pushToTalk";
import { transcribe } from "@web/lib/voice/stt";
import { Speaker } from "@web/lib/voice/tts";
import { repeat } from "@web/lib/voice/repeat";
import { EARCONS, playNotes } from "@web/lib/voice/earcons";

class Recorder {
  static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
  static instances: Recorder[] = [];
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Recorder.instances.push(this); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["speech"]) });
      this.onstop?.();
    });
  }
}

beforeEach(() => { Recorder.instances = []; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function microphone() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", Recorder);
  return { stop, stream, getUserMedia };
}

describe("microphone capture", () => {
  it("emits Opus audio only after a sufficient hold and releases the microphone", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(300);
    const device = microphone();
    const mic = new PushToTalk();
    expect(await mic.start()).toBe(true);
    const clip = await mic.stop();
    expect(clip?.type).toBe("audio/webm;codecs=opus");
    expect(clip?.size).toBeGreaterThan(0);
    expect(device.stop).toHaveBeenCalled();
  });

  it("discards short holds and cancelled clips", async () => {
    const device = microphone();
    const mic = new PushToTalk();
    await mic.start();
    expect(await mic.stop()).toBeNull();
    await mic.start();
    mic.cancel();
    expect(await mic.stop()).toBeNull();
    expect(device.stop).toHaveBeenCalledTimes(2);
  });

  it("closes a late permission grant without recording", async () => {
    const device = microphone();
    let grant!: (value: unknown) => void;
    device.getUserMedia.mockReturnValue(new Promise((resolve) => { grant = resolve; }));
    const mic = new PushToTalk();
    const starting = mic.start();
    mic.cancel();
    grant(device.stream);
    expect(await starting).toBe(false);
    expect(Recorder.instances).toHaveLength(0);
    expect(device.stop).toHaveBeenCalledOnce();
  });

  it("handles permission denial and unavailable capture", async () => {
    const device = microphone();
    device.getUserMedia.mockRejectedValue(new Error("Denied"));
    expect(await new PushToTalk().start()).toBe(false);
    vi.stubGlobal("MediaRecorder", undefined);
    expect(await new PushToTalk().start()).toBe(false);
  });
});

describe("transcription", () => {
  it("validates successful results and preserves audio format", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, text: " ETF? ", confidence: 0.9 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await transcribe(new Blob(["audio"], { type: "audio/mp4" }))).toEqual({ ok: true, text: "ETF?", confidence: 0.9 });
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect((form.get("audio") as File).name).toBe("speech.m4a");
  });

  it.each([
    () => Response.json({ ok: true, text: "Buy", confidence: 0.2 }),
    () => Response.json({ ok: true, text: "Buy" }),
    () => Response.json({ error: "Too large" }, { status: 413 }),
    () => new Response("invalid json"),
  ])("uses typing fallback for unreliable or failed responses", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    expect((await transcribe(new Blob(["audio"]))).ok).toBe(false);
  });
});

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  play = vi.fn(async () => {});
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();
  constructor(public src: string) { super(); FakeAudio.instances.push(this); }
}

function playback() {
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("MediaSource", undefined);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const synthesis = { cancel: vi.fn(), speak: vi.fn<(utterance: any) => void>() };
  vi.stubGlobal("speechSynthesis", synthesis);
  vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
  return { revoke, synthesis };
}

async function audioReady() {
  await vi.waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThan(0));
  return FakeAudio.instances.at(-1)!;
}

describe("speech playback and repeat", () => {
  it("caches audio for repeat, redraws the chart, and revokes object URLs", async () => {
    const { revoke } = playback();
    const fetcher = vi.fn().mockResolvedValue(new Response("audio", { headers: { "content-type": "audio/wav" } }));
    vi.stubGlobal("fetch", fetcher);
    const speaker = new Speaker();
    const speaking = speaker.speak("An ETF holds many companies.");
    (await audioReady()).dispatchEvent(new Event("ended"));
    await speaking;
    const redraw = vi.fn();
    const repeating = repeat(speaker, redraw);
    FakeAudio.instances.at(-1)!.dispatchEvent(new Event("ended"));
    expect(await repeating).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(redraw).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("settles interrupted playback and aborts its request", async () => {
    playback();
    const fetcher = vi.fn().mockResolvedValue(new Response("audio"));
    vi.stubGlobal("fetch", fetcher);
    const speaker = new Speaker();
    const speaking = speaker.speak("Hello");
    const audio = await audioReady();
    speaker.stop();
    await speaking;
    expect(audio.pause).toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("ignores an old speech response that arrives after a new utterance starts", async () => {
    playback();
    let respond!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { respond = resolve; }))
      .mockResolvedValueOnce(new Response("new audio"));
    vi.stubGlobal("fetch", fetcher);
    const speaker = new Speaker();
    const oldSpeech = speaker.speak("Old reply");
    const newSpeech = speaker.speak("New reply");
    const audio = await audioReady();
    respond(new Response("old audio"));
    await oldSpeech;
    expect(FakeAudio.instances).toHaveLength(1);
    expect(speaker.last?.text).toBe("New reply");
    audio.dispatchEvent(new Event("ended"));
    await newSpeech;
  });

  it("uses browser speech when the server fails, and repeats without fetching", async () => {
    const { synthesis } = playback();
    synthesis.speak.mockImplementation((utterance) => queueMicrotask(() => utterance.onend()));
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const speaker = new Speaker();
    await speaker.speak("Hello", "slow");
    await speaker.repeat();
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    expect(synthesis.speak.mock.calls[0][0].rate).toBe(0.85);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("settles cancelled browser speech even when the browser omits onend", async () => {
    const { synthesis } = playback();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const speaker = new Speaker();
    const speaking = speaker.speak("Hello");
    await vi.waitFor(() => expect(synthesis.speak).toHaveBeenCalledOnce());
    speaker.stop();
    await speaking;
  });

  it("starts streaming playback before the response is complete", async () => {
    playback();
    class Buffer extends EventTarget {
      appendBuffer() { queueMicrotask(() => this.dispatchEvent(new Event("updateend"))); }
    }
    class Source extends EventTarget {
      static isTypeSupported = () => true;
      readyState = "open";
      constructor() { super(); setTimeout(() => this.dispatchEvent(new Event("sourceopen")), 0); }
      addSourceBuffer() { return new Buffer(); }
      endOfStream() { this.readyState = "ended"; }
    }
    vi.stubGlobal("MediaSource", Source);
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "audio/mpeg" } })));
    const speaker = new Speaker();
    const speaking = speaker.speak("Hello");
    stream.enqueue(new Uint8Array([1, 2, 3]));
    await vi.waitFor(() => expect(FakeAudio.instances[0]?.play).toHaveBeenCalled());
    expect(speaker.last?.audio).toBeNull();
    stream.enqueue(new Uint8Array([4, 5]));
    stream.close();
    await vi.waitFor(() => expect(speaker.last?.audio?.size).toBe(5));
    FakeAudio.instances[0].dispatchEvent(new Event("ended"));
    await speaking;
  });
});

describe("earcons", () => {
  it("schedules the rising and falling tones with an amplitude envelope", () => {
    const frequency = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    const gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    const output = { gain, connect: vi.fn() };
    const oscillator = { frequency, connect: vi.fn().mockReturnValue(output), start: vi.fn(), stop: vi.fn(), type: "sine" };
    const context = { currentTime: 10, createOscillator: () => oscillator, createGain: () => output, destination: {} };
    playNotes(EARCONS["listen-start"], context as unknown as AudioContext);
    expect(frequency.setValueAtTime).toHaveBeenCalledWith(440, 10.01);
    expect(frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(660, expect.closeTo(10.13));
    expect(gain.exponentialRampToValueAtTime).toHaveBeenCalledTimes(2);
    expect(EARCONS["listen-end"][0].from).toBeGreaterThan(EARCONS["listen-end"][0].to);
  });
});
