// Example repronote home widget: days (and hours of class) before the next holidays.
// Runs in a sandbox (a Worker, no page, no network): only `repronote.data.timetable` /
// `holidays` (permission "timetable"); repronote.render() shows the HTML.
repronote.onUpdate((data) => {
  const now = new Date();
  const next = (data.holidays ?? []).map((h) => ({ ...h, start: new Date(h.startDate) })).filter((h) => h.start > now).sort((a, b) => a.start - b.start)[0];
  if (!next) return repronote.render('<p class="muted">Pas de vacances à venir dans les données synchronisées.</p>');
  const days = Math.ceil((next.start - now) / 864e5);
  const hours = (data.timetable ?? [])
    .filter((c) => !c.canceled && new Date(c.startDate) > now && new Date(c.startDate) < next.start)
    .reduce((n, c) => n + (new Date(c.endDate) - new Date(c.startDate)) / 36e5, 0);
  const sub = hours ? `encore ${Math.round(hours)} h de cours (période synchronisée)` : next.start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  repronote.render(repronote.html`
    <div style="font-size:2.4rem;font-weight:800;color:var(--accent);line-height:1">J-${days}</div>
    <div style="font-weight:600">${next.name}</div>
    <div class="muted">${sub}</div>`);
});
