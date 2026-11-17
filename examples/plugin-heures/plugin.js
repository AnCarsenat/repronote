// Example repronote plugin: hours of class per subject.
// Runs in a sandbox: `repronote.data` holds only what the manifest asked for
// (here: timetable), there is no network, and the page is #app.
const app = document.getElementById("app");

function render(data) {
  const lessons = (data.timetable ?? []).filter((c) => !c.canceled);
  const hours = new Map();
  for (const c of lessons) {
    const name = c.subject?.name ?? c.title ?? "Autre";
    hours.set(name, (hours.get(name) ?? 0) + (new Date(c.endDate) - new Date(c.startDate)) / 3_600_000);
  }
  const rows = [...hours].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((n, [, h]) => n + h, 0);
  const fmt = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

  app.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<p class="muted">${lessons.length} cours sur la période synchronisée · ${fmt(total)} au total</p>`;
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Matière</th><th>Heures</th><th>Part</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const [name, h] of rows) {
    const tr = document.createElement("tr");
    for (const text of [name, fmt(h), `${Math.round((h / total) * 100)} %`]) {
      const td = document.createElement("td");
      td.textContent = text; // never innerHTML with data
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  const button = document.createElement("button");
  button.textContent = "Exporter en CSV";
  button.style.marginTop = "12px";
  button.onclick = () => {
    const csv = ["Matière;Heures", ...rows.map(([n, h]) => `"${n.replace(/"/g, '""')}";${h.toFixed(2).replace(".", ",")}`)].join("\r\n");
    repronote.download("heures-par-matiere.csv", "text/csv; charset=utf-8", "﻿" + csv);
    repronote.storage.set({ lastExport: Date.now() });
  };
  const last = repronote.storage.get()?.lastExport;
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = last ? `Dernier export : ${new Date(last).toLocaleString("fr-FR")}` : "";
  card.append(table, button, note);
  app.append(card);
}

repronote.onUpdate(render);
