// Client state: the server's /api/state plus actions. Views subscribe to changes.

const listeners = new Set();

export const store = {
  state: null,
  serverDown: false,
  busy: null, // "sync" | "login" | null
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(store);
}

async function call(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function refresh() {
  try {
    store.state = await call("/api/state");
    store.serverDown = false;
  } catch {
    store.serverDown = true;
  }
  emit();
}

async function runAction(kind, path) {
  if (store.busy) return;
  store.busy = kind;
  emit();
  try {
    store.state = await call(path, { method: "POST" });
    store.serverDown = false;
  } catch {
    store.serverDown = true;
  } finally {
    store.busy = null;
    emit();
  }
}

export const syncNow = () => runAction("sync", "/api/sync");
export const relogin = () => runAction("login", "/api/login");

/** Ticks homework: updates the screen at once, then tells the server. */
export async function setHomeworkDone(id, done) {
  // In the synced list, or only in the archive (loaded by scrolling).
  const item =
    store.state?.data?.homework?.data?.find((a) => a.id === id) ??
    Object.values(store.state?.data?.homeworkArchive?.data ?? {}).find((a) => a.id === id);
  if (!item) return;
  const previous = item.done;
  item.done = done;
  item.saving = true;
  emit();
  try {
    const result = await call(`/api/homework/${encodeURIComponent(id)}/done`, {
      method: "POST",
      body: JSON.stringify({ done }),
    });
    store.state = result;
  } catch {
    item.done = previous;
    item.saving = false;
    store.serverDown = true;
  }
  emit();
}

/** Data as { kind: snapshotData }. */
export const data = () =>
  Object.fromEntries(Object.entries(store.state?.data ?? {}).map(([k, v]) => [k, v.data]));

export const fetchedAt = (kind) => store.state?.data?.[kind]?.fetchedAt ?? null;

// ---- Home layout (saved on the server, shared by every browser) ----
let saveTimer = null;

/** Updates the layout on screen at once; saves it shortly after (debounced). */
export function saveLayout(layout) {
  if (!store.state) return;
  store.state.layout = layout;
  emit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    call("/api/layout", { method: "PUT", body: JSON.stringify(layout) }).catch(() => {
      store.serverDown = true;
      emit();
    });
  }, 300);
}

// ---- Subject coefficients for the overall average ----
let subjectTimer = null;

export function saveSubjectSettings(value) {
  if (!store.state) return;
  store.state.subjectSettings = value;
  emit();
  clearTimeout(subjectTimer);
  subjectTimer = setTimeout(() => {
    call("/api/subject-settings", { method: "PUT", body: JSON.stringify(value) }).catch(() => {
      store.serverDown = true;
      emit();
    });
  }, 300);
}

// ---- Informations: read state ----
/** Marks news as read/unread: on screen at once, then in Pronote. */
export async function setNewsRead(keys, read) {
  const items = store.state?.data?.news?.data?.items ?? [];
  const changed = items.filter((i) => keys.includes(i.key) && i.read !== read);
  for (const i of changed) i.read = read;
  emit();
  for (const i of changed) {
    try {
      const r = await call("/api/news/read", { method: "POST", body: JSON.stringify({ key: i.key, read }) });
      if (r?.ok === false) throw new Error(r.error);
    } catch {
      i.read = !read; // revert this one
      emit();
    }
  }
}

// ---- Homework beyond the synced window (infinite scroll) ----
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Homework due between two dates, fetched live by the server (or its archive offline). */
export async function fetchHomeworkRange(from, to) {
  const r = await call(`/api/homework/range?from=${iso(from)}&to=${iso(to)}`);
  return { items: r.items ?? [], offline: Boolean(r.offline) };
}

/** First run: log in with the given Pronote address (opens the login window on the server side). */
export async function firstLogin(url) {
  if (store.busy) return;
  store.busy = "login";
  emit();
  try {
    store.state = await call("/api/login", { method: "POST", body: JSON.stringify({ url }) });
    store.serverDown = false;
  } catch {
    // keep the welcome screen; the caller shows an error
  } finally {
    store.busy = null;
    emit();
  }
}

// ---- Notifications and webhooks (settings on the server) ----

/** Saves what to notify and where. Returns an error message, or null. */
export async function saveNotifications(settings) {
  const res = await fetch("/api/notifications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return body.error ?? `Erreur ${res.status}`;
  store.state = body;
  emit();
  return null;
}

/** Sends a test notification everywhere: { ok, errors, system }. */
export const testNotifications = () => call("/api/notifications/test", { method: "POST" });
