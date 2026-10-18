/**
 * Talk to the ESP32 palm arm over Web Serial (Chrome and Edge).
 * Sends one command at a time and waits for OK / ERR, so the arm never
 * gets ahead of the buffer.
 */

export const BAUD = 115_200;
const ACK_TIMEOUT_MS = 8_000;

type SerialPortLike = {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

export class ArmLink {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer = "";
  onStatus?: (connected: boolean) => void;

  static supported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  get connected() {
    return this.port !== null;
  }

  /** Must be called from a user gesture (the browser shows a port picker). */
  async connect(): Promise<void> {
    const serial = (navigator as any).serial;
    const port: SerialPortLike = await serial.requestPort();
    await port.open({ baudRate: BAUD });
    this.port = port;
    this.writer = port.writable!.getWriter();
    this.reader = port.readable!.pipeThrough(new TextDecoderStream() as any).getReader() as any;
    this.onStatus?.(true);
  }

  async disconnect() {
    try {
      await this.reader?.cancel();
      this.writer?.releaseLock();
      await this.port?.close();
    } finally {
      this.port = this.reader = this.writer = null;
      this.buffer = "";
      this.onStatus?.(false);
    }
  }

  private async readLine(): Promise<string> {
    const deadline = Date.now() + ACK_TIMEOUT_MS;
    while (!this.buffer.includes("\n")) {
      if (Date.now() > deadline) throw new Error("The arm did not answer.");
      const { value, done } = await this.reader!.read();
      if (done) throw new Error("The arm disconnected.");
      this.buffer += value;
    }
    const i = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, i).trim();
    this.buffer = this.buffer.slice(i + 1);
    return line;
  }

  async send(cmds: string[], onProgress?: (i: number) => void): Promise<void> {
    if (!this.writer) throw new Error("The arm is not connected.");
    const enc = new TextEncoder();
    for (let i = 0; i < cmds.length; i++) {
      await this.writer.write(enc.encode(cmds[i] + "\n"));
      let reply = await this.readLine();
      while (reply && !/^(OK|ERR)/.test(reply)) reply = await this.readLine(); // skip debug lines
      if (reply.startsWith("ERR")) throw new Error(`Arm rejected "${cmds[i]}": ${reply}`);
      onProgress?.(i);
    }
  }
}
