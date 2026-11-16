// Browser notifications: when repronote runs as a plain server (no desktop or
// Android app to show system notifications), the open tab shows new events.
import { store, subscribe } from "./state.js";

const SEEN = "repronote:seen-events";

function loadSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? "null");
  } catch {
    return null;
  }
}
function saveSeen(ids) {
  try {
    localStorage.setItem(SEEN, JSON.stringify(ids.slice(0, 100)));
  } catch {}
}

export const browserNotificationsUsable = () => typeof Notification !== "undefined" && !store.state?.systemNotifications;

subscribe(() => {
  const st = store.state;
  if (!st?.events) return;
  const ids = st.events.map((e) => e.id);
  const seen = loadSeen();
  if (seen === null) return saveSeen(ids); // first time: don't replay old events
  const fresh = st.events.filter((e) => !seen.includes(e.id));
  if (!fresh.length) return;
  saveSeen([...ids, ...seen]);
  if (!browserNotificationsUsable() || !st.notifications?.system || Notification.permission !== "granted") return;
  const shown = fresh.length > 4 ? [{ title: `${fresh.length} nouveautés sur Pronote`, body: fresh.map((e) => e.title).slice(0, 5).join("\n") }] : fresh;
  for (const e of shown) {
    try {
      new Notification(e.title, { body: e.body, tag: e.id });
    } catch {}
  }
});
