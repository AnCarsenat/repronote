import tls from "node:tls";

/**
 * Trust the system's certificates too, not only Node's built-in list.
 * Some networks (school networks such as the Île-de-France lycées) inspect
 * HTTPS with their own root certificate, installed in the system store: the
 * browser accepts it, but Node's fetch fails ("fetch failed",
 * SELF_SIGNED_CERT_IN_CHAIN), so update checks and downloads never work there.
 * Needs Node ≥ 22.15 / 23.9 (tls.getCACertificates); skipped on older Node
 * (Android's Node 18).
 */
const t = tls as typeof tls & {
  getCACertificates?: (kind: "default" | "system") => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};
try {
  if (t.getCACertificates && t.setDefaultCACertificates) {
    t.setDefaultCACertificates([...new Set([...t.getCACertificates("default"), ...t.getCACertificates("system")])]);
  }
} catch (err) {
  console.warn(`[tls] system certificates not loaded: ${err instanceof Error ? err.message : err}`);
}
