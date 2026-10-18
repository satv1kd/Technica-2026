/**
 * Driver for the PalmDraw arm (Arduino UNO R4 WiFi, firmware palm_arm.ino).
 * See PALM_ARM.md next to the firmware for the hardware and protocol.
 *
 * Protocol: 115200 baud, one command per line. Every command answers "ok"
 * when finished or a line starting with "err". Send ONE command, wait for its
 * reply, then send the next. "X" is the emergency stop and skips the queue.
 *
 * The main call is drawLine(x1, y1, x2, y2): one "W x1 y1 x2 y2" line. The
 * firmware lifts the pen, travels to the start, draws to the end, and lifts.
 * Coordinates are integers 0..1000 across the 50 x 30 mm box on the palm:
 * x sideways across the palm, y away from the arm's base.
 */

export const BAUD = 115_200;
/** The board resets when the port opens; it prints "ready" when it's up. */
export const READY_WAIT_MS = 2_500;
/** One W line is slow on purpose (6 mm/s, felt by touch): allow a long reply. */
export const COMMAND_TIMEOUT_MS = 45_000;
export const PING_TIMEOUT_MS = 5_000;

export type ArmState = "disconnected" | "connecting" | "ready" | "busy" | "stopped";

/** A line-based connection to the arm: real (Web Serial) or mock. */
export interface ArmTransport {
  readonly kind: "serial" | "mock";
  open(): Promise<void>;
  write(line: string): Promise<void>;
  /** Called with every line the arm prints. */
  onLine(cb: (line: string) => void): void;
  close(): Promise<void>;
}

/** Round and clamp to the firmware's 0..1000 box. */
export const box = (v: number) => Math.round(Math.min(1000, Math.max(0, Number(v) || 0)));

export class ArmError extends Error {}

interface Waiter {
  cmd: string;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PalmArm {
  private transport: ArmTransport | null = null;
  private waiting: Waiter | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readyWaiter: (() => void) | null = null;
  private _state: ArmState = "disconnected";
  private listeners = new Set<(msg: string) => void>();
  onState?: (state: ArmState) => void;

  constructor(private readonly timeouts = { command: COMMAND_TIMEOUT_MS, ping: PING_TIMEOUT_MS, ready: READY_WAIT_MS }) {}

  get state(): ArmState {
    return this._state;
  }

  get connected(): boolean {
    return this._state !== "disconnected" && this._state !== "connecting";
  }

  get kind(): "serial" | "mock" | null {
    return this.transport?.kind ?? null;
  }

  onLog(fn: (msg: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private log(msg: string) {
    this.listeners.forEach((fn) => fn(msg));
  }

  private setState(s: ArmState) {
    this._state = s;
    this.onState?.(s);
  }

  /** Open the transport, wait out the board reset, and ping. */
  async connect(transport: ArmTransport): Promise<void> {
    if (this.connected) await this.disconnect();
    this.setState("connecting");
    this.transport = transport;
    transport.onLine((line) => this.handleLine(line));
    try {
      const ready = new Promise<void>((resolve) => {
        this.readyWaiter = resolve;
        setTimeout(resolve, this.timeouts.ready); // no "ready" line? carry on after ~2 s
      });
      await transport.open();
      await ready;
      this.readyWaiter = null;
      this.setState("ready");
      await this.send("P", this.timeouts.ping);
      this.log(transport.kind === "mock" ? "connected (mock arm)" : "connected");
    } catch (err) {
      await this.disconnect().catch(() => {});
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    const t = this.transport;
    this.transport = null;
    this.failWaiting(new ArmError("The arm disconnected."));
    this.queue = Promise.resolve();
    this.setState("disconnected");
    await t?.close().catch(() => {});
  }

  private handleLine(raw: string) {
    const line = raw.trim();
    if (!line) return;
    this.log("arm: " + line);
    if (line === "ready") {
      this.readyWaiter?.();
      return;
    }
    const w = this.waiting;
    if (!w) return; // e.g. menu text after reset, or "ok" for a stop that came in idle
    if (line === "ok") {
      this.waiting = null;
      clearTimeout(w.timer);
      w.resolve();
    } else if (line.startsWith("err")) {
      this.waiting = null;
      clearTimeout(w.timer);
      if (line.startsWith("err stopped")) this.setState("stopped");
      w.reject(new ArmError(line));
    }
  }

  private failWaiting(err: Error) {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    clearTimeout(w.timer);
    w.reject(err);
  }

  /** Send one command and wait for its "ok". Commands never overlap. */
  send(cmd: string, timeoutMs = this.timeouts.command): Promise<void> {
    const run = () =>
      new Promise<void>((resolve, reject) => {
        const t = this.transport;
        if (!t || !this.connected) return reject(new ArmError("The arm is not connected."));
        const timer = setTimeout(() => {
          if (this.waiting?.cmd !== cmd) return;
          this.waiting = null;
          reject(new ArmError(`The arm did not answer "${cmd}".`));
        }, timeoutMs);
        this.waiting = { cmd, resolve, reject, timer };
        if (this._state === "ready") this.setState("busy");
        this.log("send: " + cmd);
        t.write(cmd + "\n").catch((err) => this.failWaiting(err as Error));
      }).finally(() => {
        if (this._state === "busy" && !this.waiting) this.setState("ready");
      });
    const p = this.queue.then(run);
    this.queue = p.catch(() => {}); // a failed command doesn't block the next one
    return p;
  }

  /** ONE straight line, box coordinates 0..1000. Resolves when the arm has drawn it. */
  drawLine(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    return this.send(`W ${box(x1)} ${box(y1)} ${box(x2)} ${box(y2)}`);
  }

  /**
   * Emergency stop: "X" goes out immediately, skipping the queue. The servos
   * go limp; nothing moves until resume().
   */
  async stop(): Promise<void> {
    const t = this.transport;
    if (!t) return;
    this.log("STOP");
    this.setState("stopped");
    // The firmware swallows X mid-move without replying, so don't wait for one.
    this.failWaiting(new ArmError("stopped"));
    this.queue = Promise.resolve();
    await t.write("X\n");
  }

  /** Turn the servos back on after a stop. */
  async resume(): Promise<void> {
    if (!this.transport) throw new ArmError("The arm is not connected.");
    this.setState("ready");
    await this.send("R", this.timeouts.ping);
  }

  home = () => this.send("H");
  /** Trace the 50 x 30 mm box so the learner can position their hand. */
  traceBox = () => this.send("T");
  /** Drawing speed in mm/s (the firmware allows 2..30; keep it slow). */
  setSpeed = (mmPerSec: number) => this.send(`S ${Math.min(30, Math.max(2, Math.round(mmPerSec)))}`);
}

// Transports -------------------------------------------------------------------

type SerialPortLike = {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

export function webSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

/**
 * Pick the arm's port. Reuses a port this site was already granted, so the
 * picker only shows the first time. Must run from a user gesture otherwise.
 */
export async function chooseSerialPort(): Promise<SerialPortLike> {
  const serial = (navigator as any).serial;
  const granted: SerialPortLike[] = await serial.getPorts();
  return granted.length === 1 ? granted[0] : serial.requestPort();
}

/** Real hardware over Web Serial (Chrome and Edge). Close the Arduino Serial Monitor first. */
export class WebSerialTransport implements ArmTransport {
  readonly kind = "serial" as const;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private cb: (line: string) => void = () => {};
  private closed = false;

  constructor(private readonly port: SerialPortLike) {}

  onLine(cb: (line: string) => void) {
    this.cb = cb;
  }

  async open() {
    try {
      await this.port.open({ baudRate: BAUD });
    } catch (err) {
      throw new ArmError(
        `Couldn't open the arm's port. Close the Arduino Serial Monitor and try again. (${(err as Error).message})`,
      );
    }
    this.writer = this.port.writable!.getWriter();
    void this.readLoop();
  }

  private async readLoop() {
    const decoder = new TextDecoder();
    let buffer = "";
    this.reader = this.port.readable!.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf("\n")) >= 0) {
          this.cb(buffer.slice(0, i).replace(/\r$/, ""));
          buffer = buffer.slice(i + 1);
        }
      }
    } catch {
      // The port closed or the cable came out.
    } finally {
      this.reader?.releaseLock();
    }
  }

  async write(line: string) {
    if (!this.writer || this.closed) throw new ArmError("The arm is not connected.");
    await this.writer.write(new TextEncoder().encode(line));
  }

  async close() {
    this.closed = true;
    try {
      await this.reader?.cancel();
    } catch {}
    try {
      this.writer?.releaseLock();
    } catch {}
    await this.port.close().catch(() => {});
  }
}

/**
 * No hardware: logs every command and answers like the firmware does, so the
 * whole app can be tested without the arm.
 */
export class MockTransport implements ArmTransport {
  readonly kind = "mock" as const;
  readonly sent: string[] = [];
  private cb: (line: string) => void = () => {};
  private stopped = false;

  /** msPerLine: how long a pretend W line takes (the real arm needs seconds). */
  constructor(private readonly msPerLine = 250) {}

  onLine(cb: (line: string) => void) {
    this.cb = cb;
  }

  async open() {
    setTimeout(() => this.cb("ready"), 20);
  }

  async write(line: string): Promise<void> {
    const cmd = line.trim();
    this.sent.push(cmd);
    console.info(`[mock arm] ${cmd}`);
    const reply = (text: string, ms: number): void => {
      setTimeout(() => this.cb(text), ms);
    };
    const c = cmd[0];
    if (c === "X") {
      this.stopped = true;
      return;
    }
    if (c === "R") {
      this.stopped = false;
      return reply("ok", 10);
    }
    if (c === "P") return reply("ok", 5);
    if (this.stopped) return reply("err stopped (type a / send R)", 5);
    if (c === "W") {
      const n = cmd.split(/\s+/).slice(1).map(Number);
      if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return reply("err need W x1 y1 x2 y2", 5);
      return reply("ok", this.msPerLine);
    }
    if ("MLUDHTS".includes(c)) return reply("ok", c === "T" ? this.msPerLine * 4 : this.msPerLine);
    return reply("err unknown command", 5);
  }

  async close() {}
}
