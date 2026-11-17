// Plugins: optional tools, opened from the "Plugins" page (#/plugins/<id>).
// A plugin is { id, title, description, icon (SVG path), render(data, rerender) }.
// Built-in ones live here; others are installed from GitHub (github.js).
import calculators from "./calculators.js";
import sharedTimetable from "./shared-timetable.js";
import { installedPlugins } from "./github.js";

export const BUILTIN = [calculators, sharedTimetable];

export const allPlugins = () => [...BUILTIN, ...installedPlugins()];

export const findPlugin = (id) => allPlugins().find((p) => p.id === id) ?? null;
