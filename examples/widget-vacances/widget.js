// Example repronote home widget: days (and hours of class) before the next holidays.
// Runs in a sandbox: only `repronote.data.timetable` / `holidays` (permission "timetable"), no network.
const app = document.getElementById("app");

repronote.onUpdate((data) => {
  const now = new Date();
  const next = (data.holidays ?? []).map((h) => ({ ...h, start: new Date(h.startDate) })).filter((h) => h.start > now).sort((a, b) => a.start - b.start)[0];
  app.textContent = "";
  if (!next) {
    app.innerHTML = '<p class="muted">Pas de vacances à venir dans les données synchronisées.</p>';
    return;
  }
  const days = Math.ceil((next.start - now) / 864e5);
  const hours = (data.timetable ?? [])
    .filter((c) => !c.canceled && new Date(c.startDate) > now && new Date(c.startDate) < next.start)
    .reduce((n, c) => n + (new Date(c.endDate) - new Date(c.startDate)) / 36e5, 0);
  const big = document.createElement("div");
  big.style.cssText = "font-size:2.4rem;font-weight:800;color:var(--accent);line-height:1";
  big.textContent = `J-${days}`;
  const name = document.createElement("div");
  name.style.fontWeight = "600";
  name.textContent = next.name;
  const sub = document.createElement("div");
  sub.className = "muted";
  sub.textContent = hours ? `encore ${Math.round(hours)} h de cours (période synchronisée)` : next.start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  app.append(big, name, sub);
});
