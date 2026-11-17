// A small Markdown editor, styled as you type (no separate preview): titles
// are big, **bold** is bold, lists get bullets, "- [ ]" becomes a checkbox.
// The markers (#, **, - …) stay in the text, dimmed while editing and hidden
// otherwise. The text itself is plain Markdown.
//
// Supported: # ## ### titles, **bold**, *italic* / _italic_, ~~strike~~,
// `code`, [link](https://…), bare https:// links, - lists, 1. lists,
// - [ ] / - [x] tasks, > quotes, --- separators.

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mark = (s) => `<span class="md-mark">${esc(s)}</span>`;
const safeHref = (url) => (/^(https?:|mailto:)/i.test(url) ? url : null);

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(~~[^~\n]+?~~)|(\*[^*\s][^*\n]*?\*)|(_[^_\s][^_\n]*?_)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/g;

function inline(text) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    out += esc(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out += `<code class="md-code">${mark("`")}${esc(t.slice(1, -1))}${mark("`")}</code>`;
    else if (m[2]) out += `<strong>${mark("**")}${esc(t.slice(2, -2))}${mark("**")}</strong>`;
    else if (m[3]) out += `<s>${mark("~~")}${esc(t.slice(2, -2))}${mark("~~")}</s>`;
    else if (m[4] || m[5]) out += `<em>${mark(t[0])}${esc(t.slice(1, -1))}${mark(t[0])}</em>`;
    else if (m[6]) {
      const [, label, url] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      const href = safeHref(url);
      out += `<span class="md-link"${href ? ` data-href="${esc(href)}"` : ""}>${mark("[")}${esc(label)}${mark(`](${url})`)}</span>`;
    } else {
      const href = safeHref(t);
      out += `<span class="md-link"${href ? ` data-href="${esc(href)}"` : ""}>${esc(t)}</span>`;
    }
    last = m.index + t.length;
  }
  return out + esc(text.slice(last));
}

function lineHTML(line) {
  let m;
  const div = (cls, html) => `<div class="md-line ${cls}">${html || "<br>"}</div>`;
  if (!line) return div("", "");
  if ((m = /^(#{1,3})(\s+)(.*)$/.exec(line))) return div(`md-h${m[1].length}`, mark(m[1] + m[2]) + inline(m[3]));
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return div("md-hr", mark(line));
  if ((m = /^(>\s?)(.*)$/.exec(line))) return div("md-quote", mark(m[1]) + inline(m[2]));
  if ((m = /^(\s*)([-*+]\s)\[([ xX])\](\s)(.*)$/.exec(line))) {
    const done = m[3] !== " ";
    return div(`md-task ${done ? "done" : ""}`,
      esc(m[1]) + mark(m[2]) + `<span class="md-box" data-box="1">${esc(`[${m[3]}]`)}</span>` + esc(m[4]) + `<span class="md-task-text">${inline(m[5])}</span>`);
  }
  if ((m = /^(\s*)([-*+])(\s+)(.*)$/.exec(line))) return div("md-li", esc(m[1]) + `<span class="md-bullet">${esc(m[2])}</span>` + esc(m[3]) + inline(m[4]));
  if ((m = /^(\s*)(\d+[.)])(\s+)(.*)$/.exec(line))) return div("md-ol", esc(m[1]) + `<span class="md-num">${esc(m[2])}</span>` + esc(m[3]) + inline(m[4]));
  return div("", inline(line));
}

export const markdownHTML = (text) => String(text ?? "").split("\n").map(lineHTML).join("");

// ---- Plain text <-> DOM positions ----

const BLOCK = /^(DIV|P|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE)$/;

/** The editor's text, and the caret position in it when (node, offset) is given. */
function serialize(root, cNode = null, cOff = 0) {
  let text = "";
  let pos = null;
  let blocks = 0;
  let needNL = false;
  const add = (s) => {
    if (needNL) {
      text += "\n";
      needNL = false;
    }
    text += s;
  };
  const walk = (node) => {
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (node === cNode && cOff === i && pos === null) {
        if (needNL) add("");
        pos = text.length;
      }
      const ch = kids[i];
      if (ch.nodeType === 3) {
        add("");
        if (ch === cNode) pos = text.length + Math.min(cOff, ch.data.length);
        text += ch.data;
      } else if (ch.nodeName === "BR") {
        // A <br> closing a block is only there to give an empty line its height.
        if (!(i === kids.length - 1 && node !== root && BLOCK.test(node.nodeName))) add("\n");
      } else if (ch.nodeType === 1) {
        const block = BLOCK.test(ch.nodeName);
        if (block && (blocks > 0 || text.length > 0)) needNL = true;
        if (block) blocks++;
        walk(ch);
        if (block) needNL = true;
      }
    }
    if (node === cNode && cOff === kids.length && pos === null) pos = text.length;
  };
  walk(root);
  return { text, pos };
}

/** Caret position (in characters of the Markdown text), or null. */
export function caretOffset(el) {
  const sel = getSelection();
  if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return null;
  return serialize(el, sel.focusNode, sel.focusOffset).pos;
}

/** Puts the caret at `offset` in an editor rendered by markdownHTML(). */
export function setCaret(el, offset) {
  const sel = getSelection();
  if (!sel) return;
  const range = document.createRange();
  let rest = Math.max(0, offset ?? 0);
  const lines = [...el.children];
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].textContent.length;
    if (rest <= len || i === lines.length - 1) {
      const walker = document.createTreeWalker(lines[i], NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (rest <= node.data.length) {
          range.setStart(node, rest);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        rest -= node.data.length;
      }
      range.setStart(lines[i], 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    rest -= len + 1;
  }
}

// ---- The editor ----

/**
 * A contenteditable editor. onChange(text) is called on every change.
 * Options: { id, placeholder, className }.
 */
export function createEditor(text, onChange, { id, placeholder = "Écrivez ici…", className = "" } = {}) {
  const el = document.createElement("div");
  el.className = `md-editor ${className}`;
  if (id) el.id = id;
  el.contentEditable = "plaintext-only";
  if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
  el.spellcheck = true;
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-multiline", "true");
  el.dataset.placeholder = placeholder;

  let value = String(text ?? "");
  const undo = [];
  const redo = [];
  let lastPush = 0;

  const paint = (pos) => {
    el.innerHTML = markdownHTML(value);
    el.classList.toggle("empty", value === "");
    if (pos !== undefined && pos !== null && document.activeElement === el) setCaret(el, pos);
  };
  const commit = (next, pos, { history = true } = {}) => {
    if (next === value) return paint(pos);
    if (history) {
      const now = Date.now();
      if (now - lastPush > 600 || !undo.length) undo.push({ text: value, pos: caretOffset(el) ?? value.length });
      if (undo.length > 200) undo.shift();
      redo.length = 0;
      lastPush = now;
    }
    value = next;
    paint(pos);
    onChange(value);
  };
  paint();

  let composing = false;
  el.addEventListener("compositionstart", () => (composing = true));
  el.addEventListener("compositionend", () => {
    composing = false;
    const { text: t, pos } = serialize(el, getSelection().focusNode, getSelection().focusOffset);
    commit(t, pos);
  });
  el.addEventListener("input", () => {
    if (composing) return;
    const sel = getSelection();
    const { text: t, pos } = serialize(el, sel.focusNode, sel.focusOffset);
    commit(t, pos);
  });

  el.addEventListener("keydown", (e) => {
    if (composing || e.isComposing) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
      e.preventDefault();
      const from = key === "y" || e.shiftKey ? redo : undo;
      const to = from === undo ? redo : undo;
      const step = from.pop();
      if (!step) return;
      to.push({ text: value, pos: caretOffset(el) ?? value.length });
      value = step.text;
      paint(step.pos);
      onChange(value);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (key === "b" || key === "i")) {
      // Wrap the selection in ** or *.
      e.preventDefault();
      const sel = getSelection();
      const a = serialize(el, sel.anchorNode, sel.anchorOffset).pos ?? 0;
      const b = serialize(el, sel.focusNode, sel.focusOffset).pos ?? 0;
      const [s, f] = a <= b ? [a, b] : [b, a];
      const w = key === "b" ? "**" : "*";
      commit(value.slice(0, s) + w + value.slice(s, f) + w + value.slice(f), f + w.length * (f > s ? 2 : 1));
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    // Enter: a new line, continuing the list (an empty item ends the list).
    e.preventDefault();
    const sel = getSelection();
    const pos = serialize(el, sel.focusNode, sel.focusOffset).pos ?? value.length;
    const anchor = serialize(el, sel.anchorNode, sel.anchorOffset).pos ?? pos;
    const [s, f] = anchor <= pos ? [anchor, pos] : [pos, anchor];
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const line = value.slice(lineStart, s);
    const m = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )(.*)$/.exec(line);
    if (m && !m[5].trim() && f === s) {
      // Empty item: remove its marker instead.
      commit(value.slice(0, lineStart) + value.slice(s), lineStart);
      return;
    }
    lastPush = 0; // a new line starts a new undo step
    let cont = "";
    if (m) cont = m[1] + (m[3] ? `${Number(m[3]) + 1}${m[4]} ` : m[2].replace(/\[[xX]\]/, "[ ]"));
    commit(value.slice(0, s) + "\n" + cont + value.slice(f), s + 1 + cont.length);
  });

  el.addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
  });

  // Not editing: tasks toggle and links open with a click.
  el.addEventListener("mousedown", (e) => {
    const box = e.target.closest?.(".md-box");
    const link = e.target.closest?.(".md-link[data-href]");
    if (document.activeElement === el && !(e.ctrlKey || e.metaKey)) return;
    if (box) {
      e.preventDefault();
      const lineEl = box.closest(".md-line");
      const index = [...el.children].indexOf(lineEl);
      const lines = value.split("\n");
      if (index < 0 || index >= lines.length) return;
      lines[index] = lines[index].replace(/\[([ xX])\]/, (_, c) => (c === " " ? "[x]" : "[ ]"));
      commit(lines.join("\n"));
    } else if (link) {
      e.preventDefault();
      window.open(link.dataset.href, "_blank", "noopener,noreferrer");
    }
  });

  el.getValue = () => value;
  return el;
}
