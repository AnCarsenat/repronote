import { createCipheriv, createHash } from "node:crypto";
import type { SessionHandle } from "@blockshub/pawnote-lts";

/** Download URL of a Pronote file, same scheme as pawnote: AES({N, Actif}) with the session key. */
export function attachmentURL(session: SessionHandle, id: string, name: string): string {
  const info = session.information;
  const md5 = (v: string) => createHash("md5").update(Buffer.from(v, "latin1")).digest();
  const cipher = createCipheriv("aes-128-cbc", md5(info.aesKey), md5(info.aesIV));
  const enc = Buffer.concat([cipher.update(JSON.stringify({ N: id, Actif: true }), "utf8"), cipher.final()]).toString("hex");
  return `${info.url}/FichiersExternes/${enc}/${encodeURIComponent(name)}?Session=${info.id}`;
}
