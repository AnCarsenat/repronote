// Home screen widgets. To add one, create a module in this folder and list it here.
//
// A widget exports:
//   type         unique id
//   title        shown in the card header and the "add widget" gallery
//   description  one line for the gallery
//   needs        snapshot kinds it reads ("homework", "timetable", "grades", "user", "holidays")
//   defaults     default settings
//   settings     fields for the gear panel: { key, label, type: "number" | "boolean" | "select",
//                min?, max?, options?: [{ value, label }] }
//   render(data, settings)  returns DOM node(s), built with h() from ../lib.js.
//                It only reads the local copy, so it works offline.
//
// Shared pieces live in ../components.js and ../charts.js.
import now from "./now.js";
import day from "./day.js";
import todo from "./todo.js";
import tests from "./tests.js";
import workload from "./workload.js";
import recentGrades from "./recent-grades.js";

export const widgetTypes = [now, day, todo, tests, workload, recentGrades];
export const widgetType = (type) => widgetTypes.find((w) => w.type === type);

// `col`: column on wide screens (0 = left). Narrower screens merge columns.
export const defaultLayout = () => ({
  widgets: [
    { id: "now", type: "now", col: 0 },
    { id: "recent-grades", type: "recent-grades", col: 0 },
    { id: "todo", type: "todo", col: 1 },
    { id: "tests", type: "tests", col: 2 },
    { id: "workload", type: "workload", col: 2 },
  ],
});
