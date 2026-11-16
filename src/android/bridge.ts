import { connect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";

/**
 * Talks to the Android app (Java) over a localhost TCP port it opened for us.
 * Other apps on the phone can reach localhost too, so every connection starts
 * with the secret token the app passed in our environment, then a mode:
 * - "control": newline-delimited JSON (open/close login WebViews, events back)
 * - "cdp":     raw pipe to the WebViews' DevTools socket (HTTP + WebSocket)
 */
const PORT = Number(process.env.REPRONOTE_BRIDGE_PORT);
const TOKEN = process.env.REPRONOTE_BRIDGE_TOKEN ?? "";

function open(mode: "control" | "cdp"): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(PORT, "127.0.0.1", () => {
      socket.write(`${TOKEN} ${mode}\n`);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

// ---- control channel -------------------------------------------------------

export class Control extends EventEmitter {
  private socket: Socket | null = null;
  private buffer = "";

  async send(message: Record<string, unknown>): Promise<void> {
    if (!this.socket || this.socket.destroyed) {
      this.socket = await open("control");
      this.socket.setEncoding("utf8");
      this.socket.on("data", (chunk: string) => {
        this.buffer += chunk;
        let nl;
        while ((nl = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, nl);
          this.buffer = this.buffer.slice(nl + 1);
          if (line.trim()) this.emit("event", JSON.parse(line));
        }
      });
      this.socket.on("close", () => (this.socket = null));
    }
    this.socket.write(JSON.stringify(message) + "\n");
  }
}

// ---- DevTools: HTTP target list -------------------------------------------

export type CdpTarget = { id: string; type: string; title: string; url: string; webSocketDebuggerUrl?: string };

export async function listTargets(): Promise<CdpTarget[]> {
  const socket = await open("cdp");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`DevTools target list timed out (got: ${Buffer.concat(chunks).toString("utf8").slice(0, 200) || "nothing"})`));
    }, 5000);
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("error", reject);
    socket.on("close", () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error(`Bad DevTools target list: ${raw.slice(0, 200)}`));
      }
    });
    socket.write("GET /json/list HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  });
}

// ---- DevTools: WebSocket session -------------------------------------------

/** A minimal WebSocket client (text frames), enough for the DevTools protocol. */
export class CdpSession extends EventEmitter {
  private socket!: Socket;
  private nextId = 1;
  private calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  closed = false;

  static async attach(targetId: string): Promise<CdpSession> {
    const session = new CdpSession();
    session.socket = await open("cdp");
    await session.handshake(`/devtools/page/${targetId}`);
    return session;
  }

  private handshake(path: string): Promise<void> {
    const key = randomBytes(16).toString("base64");
    return new Promise((resolve, reject) => {
      let head = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end < 0) return;
        this.socket.off("data", onData);
        const status = head.subarray(0, head.indexOf("\r\n")).toString();
        if (!/ 101 /.test(status)) return reject(new Error(`DevTools WebSocket refused: ${status}`));
        this.socket.on("data", (c: Buffer) => this.onData(c));
        this.socket.on("close", () => this.onClose());
        const rest = head.subarray(end + 4);
        if (rest.length) this.onData(rest);
        resolve();
      };
      this.socket.on("data", onData);
      this.socket.once("error", reject);
      this.socket.write(
        `GET ${path} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("DevTools session closed"));
    const id = this.nextId++;
    this.writeFrame(0x1, Buffer.from(JSON.stringify({ id, method, params })));
    return new Promise((resolve, reject) => this.calls.set(id, { resolve, reject }));
  }

  close(): void {
    if (this.closed) return;
    try {
      this.writeFrame(0x8, Buffer.alloc(0));
    } catch {}
    this.socket.end();
    this.onClose();
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    const mask = randomBytes(4);
    const len = payload.length;
    const header = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    if (len < 126) header[1] = 0x80 | len;
    else if (len < 65536) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const fin = (this.buffer[0] & 0x80) !== 0;
      const opcode = this.buffer[0] & 0x0f;
      let len = this.buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        len = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      // Server frames are never masked.
      if (this.buffer.length < offset + len) return;
      const payload = this.buffer.subarray(offset, offset + len);
      this.buffer = this.buffer.subarray(offset + len);
      if (opcode === 0x8) return this.close();
      if (opcode === 0x9) {
        this.writeFrame(0xa, payload);
        continue;
      }
      if (opcode === 0x1 || opcode === 0x0) {
        this.fragments.push(Buffer.from(payload));
        if (!fin) continue;
        const text = Buffer.concat(this.fragments).toString("utf8");
        this.fragments = [];
        this.onMessage(JSON.parse(text));
      }
    }
  }

  private onMessage(msg: any): void {
    if (msg.id !== undefined) {
      const call = this.calls.get(msg.id);
      this.calls.delete(msg.id);
      if (!call) return;
      if (msg.error) call.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else call.resolve(msg.result);
    } else if (msg.method) {
      this.emit("event", msg.method, msg.params);
    }
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const call of this.calls.values()) call.reject(new Error("DevTools session closed"));
    this.calls.clear();
    this.emit("close");
  }
}
