// CI: on an emulator with the app running, starts a login from inside the UI
// WebView (as the welcome screen does) with Pronote's public demo, so the
// screenshots and logcat show whether the login WebView appears.
// Usage: node scripts/android-login-test.mjs
import { execFileSync } from "node:child_process";

const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" }).trim();
const pid = adb("shell", "pidof", "io.github.ancarsenat.repronote");
adb("forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`);
const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
console.log("targets:", targets.map((t) => `${t.title} ${t.url}`));
const ui = targets.find((t) => t.url.startsWith("http://127.0.0.1"));
if (!ui) throw new Error("UI WebView not found");

const ws = new WebSocket(ui.webSocketDebuggerUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
const expression = `fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://demo.index-education.net/pronote/" }) }).then(r => r.status + " " + r.statusText).catch(e => "error " + e)`;
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: false } }));
await new Promise((r) => setTimeout(r, 1000));
ws.close();
console.log("login requested");
