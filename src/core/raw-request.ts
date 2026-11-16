import { createCipheriv, createHash } from "node:crypto";
import type { SessionHandle } from "@blockshub/pawnote-lts";

/**
 * Calls a Pronote function pawnote doesn't wrap (e.g. "Casier" for documents),
 * on the same session and request queue as pawnote, so request numbers stay
 * in sync. Only for sessions without payload encryption/compression, which is
 * the case for the mobile pages we use (checked below).
 */
export async function rawRequest(
  session: SessionHandle,
  name: string,
  data: unknown,
  onglet?: number | Record<string, unknown>,
): Promise<any> {
  const info = session.information;
  if (!info.skipEncryption || !info.skipCompression) {
    throw new Error(`rawRequest(${name}): encrypted sessions are not supported`);
  }

  return session.queue.push(async () => {
    info.order++;
    const order = encryptOrder(info.order, info.aesKey, info.order === 1 ? "" : info.aesIV);
    const dataSec: Record<string, unknown> = { data };
    if (onglet !== undefined) dataSec.Signature = typeof onglet === "number" ? { onglet } : onglet;

    let res: Response;
    try {
      res = await fetch(`${info.url}/appelfonction/${info.accountKind}/${info.id}/${order}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: info.id, no: order, id: name, dataSec }),
      });
    } finally {
      // Pronote answers with the next number either way.
      info.order++;
    }

    const body = JSON.parse(await res.text());
    if (body.Erreur) throw new Error(`${name}: ${body.Erreur.Titre ?? JSON.stringify(body.Erreur)}`);
    // Pronote also reports refused requests here, with an empty answer.
    const sig = body.dataSec?.Signature;
    if (sig?.Erreur) throw new Error(`${name}: refused by Pronote${sig.MessageErreur ? ` (${sig.MessageErreur})` : ""}`);
    return body.dataSec?.data ?? body.dataSec;
  });
}

function encryptOrder(order: number, aesKey: string, aesIV: string): string {
  const md5 = (s: string) => createHash("md5").update(Buffer.from(s, "latin1")).digest();
  const iv = aesIV.length ? md5(aesIV) : Buffer.alloc(16);
  const cipher = createCipheriv("aes-128-cbc", md5(aesKey), iv);
  return Buffer.concat([cipher.update(String(order), "utf8"), cipher.final()]).toString("hex");
}
