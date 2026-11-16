// Android app: the Java side starts this script in the embedded Node runtime
// (nodejs-mobile) with REPRONOTE_DATA_DIR, PORT, REPRONOTE_ACCESS_TOKEN and
// the bridge port/token in the environment, then shows the UI in a WebView.
import { setBrowserDriver } from "../core/browser-driver.ts";
import { androidDriver } from "./android-driver.ts";

setBrowserDriver(androidDriver);

const { startServer } = await import("../server.ts");
await startServer({ port: Number(process.env.PORT ?? 4173), host: "127.0.0.1" });
