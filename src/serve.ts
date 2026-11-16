// `npm run serve`: the local server on its own (PORT, HOST env vars).
import { startServer } from "./server.ts";

const { stop } = await startServer();

// Log out of Pronote on Ctrl+C so the next start isn't refused.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
}
