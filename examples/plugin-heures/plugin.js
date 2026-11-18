// Example repronote plugin: hours of class per subject.
// Runs in a sandbox (a Worker, no page, no network): `repronote.data` holds only
// what the manifest asked for (here: timetable), and repronote.render() shows HTML.
const fmt = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
let rows = [];

function render(data) {
  const lessons = (data.timetable ?? []).filter((c) => !c.canceled);
  const hours = new Map();
  for (const c of lessons) {
    const name = c.subject?.name ?? c.title ?? "Autre";
    hours.set(name, (hours.get(name) ?? 0) + (new Date(c.endDate) - new Date(c.startDate)) / 3_600_000);
  }
  rows = [...hours].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((n, [, h]) => n + h, 0);
  const last = repronote.storage.get()?.lastExport;

  // html`…` escapes every ${value}: data can't inject markup.
  repronote.render(repronote.html`
    <div class="card">
      <p class="muted">${lessons.length} cours sur la période synchronisée · ${fmt(total)} au total</p>
      <table>
        <thead><tr><th>Matière</th><th>Heures</th><th>Part</th></tr></thead>
        <tbody>${rows.map(([name, h]) => repronote.html`<tr><td>${name}</td><td>${fmt(h)}</td><td>${Math.round((h / total) * 100)} %</td></tr>`)}</tbody>
      </table>
      <button data-action="export" style="margin-top:12px">Exporter en CSV</button>
      <p class="muted">${last ? `Dernier export : ${new Date(last).toLocaleString("fr-FR")}` : ""}</p>
    </div>`);
}

// Clicks on elements with data-action="export".
repronote.on("export", () => {
  const csv = ["Matière;Heures", ...rows.map(([n, h]) => `"${n.replace(/"/g, '""')}";${h.toFixed(2).replace(".", ",")}`)].join("\r\n");
  repronote.download("heures-par-matiere.csv", "text/csv; charset=utf-8", "﻿" + csv);
  repronote.storage.set({ lastExport: Date.now() });
  render(repronote.data);
});

repronote.onUpdate(render);
