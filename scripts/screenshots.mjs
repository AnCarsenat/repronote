// README screenshots from a running server (use demo data: scripts/demo-data.mjs).
// Usage: node scripts/screenshots.mjs http://localhost:4300 docs/screenshots
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:4173", out = "docs/screenshots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium" });

const shots = [
  { name: "accueil", hash: "", width: 1360, height: 860 },
  { name: "emploi-du-temps", hash: "#/edt", width: 1360, height: 860 },
  { name: "notes", hash: "#/notes", width: 1360, height: 860 },
  { name: "statistiques", hash: "#/stats", width: 1360, height: 860 },
  { name: "devoirs", hash: "#/devoirs", width: 1360, height: 860 },
  { name: "mobile", hash: "", width: 390, height: 800, mobile: true },
  { name: "sombre", hash: "", width: 1360, height: 860, dark: true },
];
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2, isMobile: !!s.mobile, colorScheme: s.dark ? "dark" : "light" });
  await page.goto(`${base}/${s.hash}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${s.name}.png` });
  await page.close();
  console.log(s.name);
}
await browser.close();
