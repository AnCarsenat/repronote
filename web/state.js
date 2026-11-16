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
  const list = store.state?.data?.homework?.data;
  const item = list?.find((a) => a.id === id);
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
