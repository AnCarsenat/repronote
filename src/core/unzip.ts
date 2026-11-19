import { inflateRawSync } from "node:zlib";

/**
 * Reads a ZIP file (stored or deflated entries), enough for our own release
 * archives (the server zip) when updating: no dependency, and no `unzip`
 * command needed (Windows, minimal Linux). Entry names are checked so nothing
 * is written outside the target folder.
 */
export type UnzipEntry = { name: string; data: Buffer; dir: boolean; mode?: number };

export function unzip(buf: Buffer): UnzipEntry[] {
  // End of central directory: last 22 bytes + up to 64 kB of comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Archive ZIP illisible.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: UnzipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Archive ZIP abîmée.");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const external = buf.readUInt32LE(p + 38);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8").replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.startsWith("/") || name.split("/").includes("..") || /^[a-zA-Z]:/.test(name)) throw new Error(`Nom de fichier refusé dans l'archive : ${name}`);
    const dir = name.endsWith("/");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    const data = dir ? Buffer.alloc(0) : method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`Compression non gérée (${method}) pour ${name}.`);
    const mode = external >>> 16 ? (external >>> 16) & 0o777 : undefined;
    out.push({ name, data, dir, mode });
  }
  return out;
}
