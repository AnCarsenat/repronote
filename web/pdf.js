// A tiny PDF writer (rectangles and text with the built-in Helvetica fonts),
// enough to print a week timetable without any library. Works offline, in the
// desktop app and in the Android WebView.

const A4_LANDSCAPE = [842, 595];

// cp1252 (WinAnsiEncoding) for the characters French text needs.
const CP1252 = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "œ": 0x9c, "Œ": 0x8c, "Ÿ": 0x9f, " ": 0xa0, " ": 0xa0 };
function winAnsi(text) {
  let out = "";
  for (const ch of String(text ?? "").normalize("NFC")) {
    const code = ch.codePointAt(0);
    const b = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : CP1252[ch] ?? 0x3f; // "?"
    const c = String.fromCharCode(b);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return out;
}

/** Approximate Helvetica widths (in em), good enough to truncate labels. */
function charWidth(ch) {
  if (" ".includes(ch)) return 0.278;
  if ("iljI.,;:'!|ítìî".includes(ch)) return 0.26;
  if ("frt()-".includes(ch)) return 0.34;
  if ("mwMW".includes(ch)) return 0.85;
  if (/[0-9]/.test(ch)) return 0.556;
  if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) return 0.68;
  return 0.53;
}
export const textWidth = (text, size, bold = false) => [...String(text ?? "")].reduce((w, ch) => w + charWidth(ch), 0) * size * (bold ? 1.06 : 1);

/** Cuts `text` with "…" so it fits in `max` points. */
export function fit(text, size, max, bold = false) {
  const s = String(text ?? "");
  if (textWidth(s, size, bold) <= max) return s;
  let out = s;
  while (out && textWidth(`${out}…`, size, bold) > max) out = out.slice(0, -1);
  return out ? `${out.trimEnd()}…` : "";
}

/** Splits `text` into at most `maxLines` lines of `max` points. */
export function wrap(text, size, max, maxLines, bold = false) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, size, bold) <= max || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, size, max, bold);
    return kept.map((l) => fit(l, size, max, bold));
  }
  return lines.map((l) => fit(l, size, max, bold));
}

/** "#rrggbb" -> [r, g, b] in 0..1 (grey when not a hex colour). */
export function rgb(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color ?? ""));
  if (!m) return [0.55, 0.55, 0.6];
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
}
/** Mix a colour with white (t = 0: unchanged, 1: white). */
export const tint = (c, t) => c.map((v) => v + (1 - v) * t);

const num = (n) => (Math.round(n * 100) / 100).toString();

export class Pdf {
  constructor([width, height] = A4_LANDSCAPE) {
    this.width = width;
    this.height = height;
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
  }

  // Coordinates: points, from the top-left corner.
  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.5 } = {}) {
    if (!fill && !stroke) return;
    const parts = [];
    if (fill) parts.push(`${fill.map(num).join(" ")} rg`);
    if (stroke) parts.push(`${stroke.map(num).join(" ")} RG ${num(lineWidth)} w`);
    parts.push(`${num(x)} ${num(this.height - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
    this.ops.push(parts.join(" "));
  }

  line(x1, y1, x2, y2, { color = [0.8, 0.8, 0.85], width = 0.5, dash = null } = {}) {
    this.ops.push(`q ${color.map(num).join(" ")} RG ${num(width)} w ${dash ? `[${dash.join(" ")}] 0 d` : ""} ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S Q`);
  }

  /** Text whose top-left corner is at (x, y). align: "left" | "center" | "right" (x is then the center/right edge). */
  text(x, y, text, { size = 10, bold = false, color = [0.11, 0.11, 0.14], align = "left", strike = false } = {}) {
    const s = String(text ?? "");
    if (!s) return;
    const w = textWidth(s, size, bold);
    const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    const base = this.height - y - size * 0.8;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${color.map(num).join(" ")} rg ${num(left)} ${num(base)} Td (${winAnsi(s)}) Tj ET`);
    if (strike) this.line(left, y + size * 0.5, left + w, y + size * 0.5, { color, width: 0.6 });
  }

  /** The file, as a base64 string. */
  toBase64() {
    const objects = [];
    const add = (body) => objects.push(body) && objects.length;
    const catalog = add(null);
    const pagesId = add(null);
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids = [];
    for (const ops of this.pages) {
      const stream = ops.join("\n");
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return btoa(out); // every char is one byte (0..255)
  }
}

/**
 * A week grid on one A4 landscape page (plus pages for the notes if needed).
 * spec: {
 *   title, subtitle, days: Date[], startMin, endMin,
 *   blocks: [{ day, from, to, lane, lanes, color, title, lines: string[], solid?, faded?, strike? }],
 *   free?: [{ day, from, to }], legend?: [{ color, label }], notes?: { title, lines: string[] }
 * }
 */
export function weekPdf(spec) {
  const pdf = new Pdf();
  const M = 28;
  const W = pdf.width - 2 * M;
  const muted = [0.42, 0.42, 0.48];
  const border = [0.85, 0.85, 0.9];
  let y = M;

  pdf.text(M, y, spec.title, { size: 16, bold: true });
  y += 21;
  if (spec.subtitle) {
    pdf.text(M, y, fit(spec.subtitle, 9, W), { size: 9, color: muted });
    y += 14;
  }
  if (spec.legend?.length) {
    let x = M;
    for (const l of spec.legend) {
      const w = 14 + textWidth(l.label, 9) + 14;
      if (x + w > M + W) {
        x = M;
        y += 14;
      }
      pdf.rect(x, y + 1, 9, 9, { fill: l.color });
      pdf.text(x + 13, y + 1, l.label, { size: 9 });
      x += w;
    }
    y += 16;
  }

  const axisW = 30;
  const headH = 18;
  const top = y;
  const bottomReserve = spec.notes?.lines?.length ? Math.min(90, 22 + spec.notes.lines.length * 12) : 0;
  const gridH = pdf.height - M - top - bottomReserve - (bottomReserve ? 10 : 0);
  const bodyH = gridH - headH;
  const colW = (W - axisW) / spec.days.length;
  const minutes = Math.max(60, spec.endMin - spec.startMin);
  const py = (min) => top + headH + ((min - spec.startMin) / minutes) * bodyH;

  // Frame, day headers, hour lines.
  pdf.rect(M, top, W, gridH, { stroke: border });
  pdf.rect(M, top, W, headH, { fill: [0.965, 0.965, 0.975] });
  spec.days.forEach((d, i) => {
    const x = M + axisW + i * colW;
    pdf.line(x, top, x, top + gridH, { color: border });
    const label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
    pdf.text(x + colW / 2, top + 5, fit(label.charAt(0).toUpperCase() + label.slice(1), 9, colW - 6, true), { size: 9, bold: true, align: "center" });
  });
  pdf.line(M, top + headH, M + W, top + headH, { color: border });
  for (let m = Math.ceil(spec.startMin / 60) * 60; m <= spec.endMin; m += 60) {
    const yy = py(m);
    if (m > spec.startMin && m < spec.endMin) pdf.line(M + axisW, yy, M + W, yy, { color: [0.92, 0.92, 0.95], dash: [2, 2] });
    pdf.text(M + axisW - 4, Math.max(top + headH + 2, Math.min(yy - 4, top + gridH - 10)), `${m / 60}h`, { size: 7.5, color: muted, align: "right" });
  }

  // Everyone free.
  for (const f of spec.free ?? []) {
    const x = M + axisW + f.day * colW;
    pdf.rect(x + 0.5, py(f.from), colW - 1, py(f.to) - py(f.from), { fill: [0.85, 0.96, 0.9] });
    if (py(f.to) - py(f.from) > 12) pdf.text(x + 3, py(f.to) - 10, "Libres", { size: 7, bold: true, color: [0.1, 0.5, 0.29] });
  }

  // Classes.
  for (const b of spec.blocks) {
    const laneW = (colW - 4) / b.lanes;
    const x = M + axisW + b.day * colW + 2 + b.lane * laneW;
    const yy = py(b.from) + 0.5;
    const h = Math.max(6, py(b.to) - py(b.from) - 1);
    const w = laneW - 1;
    const c = b.faded ? tint(b.color, 0.55) : b.color;
    const textColor = b.solid ? [1, 1, 1] : [0.11, 0.11, 0.14];
    if (b.solid) pdf.rect(x, yy, w, h, { fill: c });
    else {
      pdf.rect(x, yy, w, h, { fill: tint(c, b.faded ? 0.7 : 0.82) });
      pdf.rect(x, yy, 2.5, h, { fill: c });
    }
    const pad = b.solid ? 3 : 5;
    const inner = w - pad - 2;
    if (inner < 12 || h < 9) continue;
    const size = h < 16 || inner < 40 ? 6.5 : 8;
    let ty = yy + 2;
    const titleLines = wrap(b.title, size, inner, h > 34 ? 2 : 1, true);
    for (const t of titleLines) {
      if (ty + size > yy + h) break;
      pdf.text(x + pad, ty, t, { size, bold: true, color: b.faded && !b.solid ? muted : textColor, strike: b.strike });
      ty += size + 1.5;
    }
    for (const l of b.lines ?? []) {
      if (ty + size - 1 > yy + h) break;
      pdf.text(x + pad, ty, fit(l, size - 0.5, inner), { size: size - 0.5, color: b.solid ? [1, 1, 1] : muted });
      ty += size + 0.5;
    }
  }

  // Notes under the grid (more pages when they don't fit).
  if (spec.notes?.lines?.length) {
    let ny = top + gridH + 12;
    pdf.text(M, ny, spec.notes.title, { size: 10, bold: true });
    ny += 15;
    for (const line of spec.notes.lines) {
      if (ny > pdf.height - M - 10) {
        pdf.addPage();
        ny = M;
      }
      pdf.text(M, ny, fit(line, 9, W), { size: 9 });
      ny += 12;
    }
  }
  return pdf.toBase64();
}
