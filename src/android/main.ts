// Android app: the Java side starts this script in the embedded Node runtime
// (nodejs-mobile) with REPRONOTE_DATA_DIR, PORT, REPRONOTE_ACCESS_TOKEN and
// the bridge port/token in the environment, then shows the UI in a WebView.
process.env.REPRONOTE_PLATFORM = "android";
process.env.REPRONOTE_ABI ??= process.arch;
import { setBrowserDriver } from "../core/browser-driver.ts";
import { androidDriver, control } from "./android-driver.ts";
import { setSystemNotifier } from "../notify/notifications.ts";

setBrowserDriver(androidDriver);
// New grades, homework…: Android notifications, posted by the Java side.
setSystemNotifier((e) => void control.send({ cmd: "notify", title: e.title, body: e.body }).catch(() => {}));

const { startServer } = await import("../server.ts");
await startServer({ port: Number(process.env.PORT ?? 4173), host: "127.0.0.1" });
