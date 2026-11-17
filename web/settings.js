// Per-device preferences (theme, accent, tabs...), kept in this browser's
// localStorage. The home layout and coefficients live on the server instead.

const KEY = "repronote:settings";
const BOOT_KEY = "repronote:accent-tokens";
/** Every localStorage key the app owns starts with this. */
export const STORAGE_PREFIX = "repronote:";

export const DEFAULT_ACCENT = "#5b5bd6";

export const DEFAULTS = Object.freeze({
  theme: "auto", // "auto" | "light" | "dark"
  accent: null, // null = default indigo, else "#rrggbb"
  textSize: "normal", // "small" | "normal" | "large"
  density: "comfortable", // "comfortable" | "compact" | "ultra"
  reduceMotion: false,
  colorblind: false, // patterns + labels in the timetables, colour-blind-safe palette
  font: "system", // key of FONTS, or "custom" (customFont)
  customFont: "",
  tabOrder: [], // view ids; views not listed keep their default place at the end
  hiddenTabs: [],
  startPage: "home",
});

const listeners = new Set();
let current = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return { ...DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode or storage full: the setting still applies until reload.
  }
}

function emit() {
  applySettings();
  for (const fn of listeners) fn(current);
}

export const getSettings = () => current;

export function setSetting(key, value) {
  current = { ...current, [key]: value };
  save();
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetSettings(keys = Object.keys(DEFAULTS)) {
  current = { ...current, ...Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]])) };
  save();
  emit();
}

/** Removes every key the app stored in this browser; settings go back to defaults. */
export function clearLocalData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(STORAGE_PREFIX)) localStorage.removeItem(k);
  } catch {
    // Nothing we can do.
  }
  current = { ...DEFAULTS };
  emit();
}

// ---- Tabs ----

/** Views in the user's order (unknown/new views keep their default order, after the known ones). */
export function orderedViews(views) {
  const order = current.tabOrder ?? [];
  const rank = (v) => {
    const i = order.indexOf(v.id);
    return i === -1 ? order.length + views.indexOf(v) : i;
  };
  return [...views].sort((a, b) => rank(a) - rank(b));
}

/** Accueil is always shown. */
export const isTabHidden = (id) => id !== "home" && (current.hiddenTabs ?? []).includes(id);

export function startView(views) {
  const v = views.find((x) => x.id === current.startPage);
  return v && !isTabHidden(v.id) ? v : views.find((x) => x.id === "home") ?? views[0];
}

// ---- Accent colour: keep text readable on both themes ----

const hexRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));
const rgbHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const LIGHT_CARD = hexRgb("#ffffff");
const DARK_CARD = hexRgb("#1d1d25");
const DARK_TEXT = hexRgb("#131318");

/** Moves `rgb` toward `target` until it reaches `ratio` against `bg`. */
function ensureContrast(rgb, bg, target, ratio) {
  let out = rgb;
  for (let t = 0; t <= 1 && contrast(out, bg) < ratio; t += 0.04) out = mix(rgb, target, t);
  return out;
}

const textOn = (rgb) => (contrast(rgb, WHITE) >= contrast(rgb, DARK_TEXT) ? "#ffffff" : "#131318");

/** Accent tokens for each theme, from one chosen colour. */
export function accentTokens(hex) {
  const base = hexRgb(hex);
  const light = ensureContrast(base, LIGHT_CARD, BLACK, 4.5); // links on white cards
  const dark = ensureContrast(mix(base, WHITE, 0.15), DARK_CARD, WHITE, 5); // a bit softer on dark
  return {
    "--accent-l": rgbHex(light),
    "--accent-text-l": textOn(light),
    "--accent-d": rgbHex(dark),
    "--accent-text-d": textOn(dark),
  };
}

// ---- Font ----
/** Font families installed on most systems (no download: the app works offline). */
export const FONTS = [
  { value: "system", label: "Système", stack: null },
  { value: "legible", label: "Très lisible", stack: '"Atkinson Hyperlegible Next", "Atkinson Hyperlegible", Verdana, "DejaVu Sans", Tahoma, sans-serif' },
  { value: "rounded", label: "Arrondie", stack: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", Quicksand, Comfortaa, system-ui, sans-serif' },
  { value: "serif", label: "Serif", stack: 'Charter, "Bitstream Charter", "Iowan Old Style", Georgia, "Noto Serif", "DejaVu Serif", serif' },
  { value: "dyslexia", label: "Dyslexie", stack: 'OpenDyslexic, Lexend, "Comic Neue", "Comic Sans MS", sans-serif' },
  { value: "mono", label: "Chasse fixe", stack: 'ui-monospace, "Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, Consolas, "DejaVu Sans Mono", monospace' },
];
/** A font name typed by the user: letters, digits, spaces and dashes only. */
export const cleanFontName = (v) => String(v ?? "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60);
export function fontStack(s = current) {
  if (s.font === "custom") {
    const name = cleanFontName(s.customFont);
    return name ? `"${name}", system-ui, sans-serif` : null;
  }
  return FONTS.find((f) => f.value === s.font)?.stack ?? null;
}

export const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Applies appearance to <html>. Safe to call before the first render. */
export function applySettings(s = current) {
  const root = document.documentElement;
  const attr = (name, value) => (value ? root.setAttribute(name, value) : root.removeAttribute(name));
  attr("data-theme", s.theme === "light" || s.theme === "dark" ? s.theme : null);
  attr("data-text", s.textSize === "small" || s.textSize === "large" ? s.textSize : null);
  attr("data-density", s.density === "compact" || s.density === "ultra" ? s.density : null);
  attr("data-motion", s.reduceMotion ? "reduce" : null);
  attr("data-colorblind", s.colorblind ? "on" : null);
  const font = fontStack(s);
  if (font) root.style.setProperty("--font", font);
  else root.style.removeProperty("--font");

  const accent = isHex(s.accent) && s.accent.toLowerCase() !== DEFAULT_ACCENT ? s.accent : null;
  const tokens = accent ? accentTokens(accent) : null;
  attr("data-accent", accent ? "custom" : null);
  for (const [k, v] of Object.entries(accentTokens(DEFAULT_ACCENT))) {
    if (tokens) root.style.setProperty(k, tokens[k]);
    else root.style.removeProperty(k);
  }
  // Read by the tiny script in index.html, so the accent is right on the first paint.
  try {
    if (tokens) localStorage.setItem(BOOT_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(BOOT_KEY);
  } catch {
    // Ignore.
  }
}

applySettings();
