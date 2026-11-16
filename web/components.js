// Pieces reused by several views and widgets.
import { h, subjectName, htmlToText, formatTime, formatDay, classTitle, subjectColor, looksLikeTest, sameDay, homeworkList } from "./lib.js";
import { setHomeworkDone, data as currentData } from "./state.js";

/**
 * Link to a Pronote file through the local server, which renews the link
 * with the live session and keeps a copy for offline use. Web links (kind 0)
 * open directly.
 */
export function fileLink(f, label = `📎 ${f.name}`) {
  if (f.kind === 0) return h("a", { href: f.url, target: "_blank", rel: "noreferrer" }, `🔗 ${f.name}`);
  const href = `/api/file?id=${encodeURIComponent(f.id)}&n=${encodeURIComponent(f.name)}&u=${encodeURIComponent(f.url ?? "")}`;
  return h("a", { href, target: "_blank", rel: "noreferrer" }, label);
}

/** One homework with its checkbox. */
export function homeworkItem(a, { showDate = false } = {}) {
  const text = htmlToText(a.description);
  const box = h("input", {
    type: "checkbox",
    checked: Boolean(a.done),
    "aria-label": `Marquer « ${subjectName(a.subject?.name)} » comme fait`,
    onchange: (e) => setHomeworkDone(a.id, e.target.checked),
  });
  return h("li", { class: `hw ${a.done ? "done" : ""}`, style: { "--subject": subjectColor(a) } },
    h("label", { class: "hw-check" }, box),
    h("div", { class: "hw-body" },
      h("div", { class: "hw-head" },
        h("span", { class: "subject" }, subjectName(a.subject?.name)),
        looksLikeTest(a) ? h("span", { class: "tag test" }, "Évaluation") : null,
        a.pending || a.saving ? h("span", { class: "tag" }, a.saving ? "Envoi…" : "En attente") : null,
        showDate ? h("span", { class: "muted small" }, a.deadline.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })) : null,
      ),
      text ? h("div", { class: "desc" }, text) : null,
      a.attachments?.length
        ? h("div", { class: "files" },
            a.attachments.map((f) => fileLink(f)),
          )
        : null,
    ),
  );
}

/** One class: time, subject, room/teacher, status. */
export function classItem(c, { now = new Date(), compact = false } = {}) {
  const past = c.endDate <= now;
  const current = c.startDate <= now && now < c.endDate;
  const where = [...(c.classrooms ?? []), ...(c.teacherNames ?? [])].filter(Boolean).join(" · ");
  return h("li", {
    class: `class clickable ${c.canceled ? "canceled" : ""} ${past ? "past" : ""} ${current ? "current" : ""} ${compact ? "compact" : ""}`,
    style: { "--subject": subjectColor(c) },
    tabindex: "0",
    role: "button",
    onclick: () => openClassDetails(c),
    onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openClassDetails(c)),
  },
    h("div", { class: "class-time" }, formatTime(c.startDate), h("span", { class: "muted" }, formatTime(c.endDate))),
    h("div", { class: "class-body" },
      h("div", { class: "class-title" }, classTitle(c)),
      where ? h("div", { class: "muted small" }, where) : null,
      h("div", { class: "tags" },
        c.canceled ? h("span", { class: "tag warn" }, c.status ?? "Annulé") : c.status ? h("span", { class: "tag" }, c.status) : null,
        c.test ? h("span", { class: "tag test" }, "Évaluation") : null,
        c.exempted ? h("span", { class: "tag" }, "Dispensé") : null,
      ),
    ),
  );
}

/**
 * Opens a modal dialog over the page (wherever you are scrolled).
 * `content` is a node or a function (close) => node. Returns close().
 */
export function openModal(title, content, { wide = false } = {}) {
  const dialog = h("dialog", { class: `modal ${wide ? "wide" : ""}`, "aria-label": title });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.append(
    h("div", { class: "modal-head" },
      h("h2", {}, title),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Fermer", onclick: close }, "✕"),
    ),
    h("div", { class: "modal-body" }, typeof content === "function" ? content(close) : content),
  );
  // Click on the backdrop closes it.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

/** Lesson content and homework linked to a class. */
function lessonExtras(c, data) {
  const subject = c.subject?.name;
  const resources = (data.resources ?? []).map((r) => ({ ...r, startDate: new Date(r.startDate) }));
  const resource =
    resources.find((r) => r.id === c.lessonResourceID) ??
    resources.find((r) => r.subject?.name === subject && Math.abs(r.startDate - c.startDate) < 60 * 60_000);
  const homework = homeworkList(data).filter((a) => a.subject?.name === subject);
  return {
    resource,
    dueThatDay: homework.filter((a) => sameDay(a.deadline, c.startDate)),
    givenThatDay: resource ? homework.filter((a) => a.resourceID === resource.id || (resource.haveAssignment && a.deadline > c.startDate && sameDay(new Date(resource.assignmentDeadline ?? 0), a.deadline))) : [],
  };
}

/** Details dialog for a class of the timetable. */
export function openClassDetails(c) {
  const data = currentData();
  const { resource, dueThatDay, givenThatDay } = lessonExtras(c, data);
  const rooms = (c.classrooms ?? []).join(", ");
  const row = (label, value) => (value ? h("div", { class: "detail-row" }, h("span", { class: "muted" }, label), h("span", {}, value)) : null);

  openModal(classTitle(c), [
    h("div", { class: "class-detail-head", style: { "--subject": subjectColor(c) } },
      h("div", { class: "detail-when" }, `${formatDay(c.startDate)} · ${formatTime(c.startDate)} – ${formatTime(c.endDate)}`),
      h("div", { class: "detail-room" }, h("span", { class: "muted small" }, "Salle"), h("strong", {}, rooms || "non précisée")),
      h("div", { class: "tags" },
        c.canceled ? h("span", { class: "tag warn" }, c.status ?? "Annulé") : c.status ? h("span", { class: "tag" }, c.status) : null,
        c.test ? h("span", { class: "tag test" }, "Évaluation") : null,
        c.exempted ? h("span", { class: "tag" }, "Dispensé") : null,
      ),
    ),
    h("div", { class: "detail-grid" },
      row("Professeur", (c.teacherNames ?? []).join(", ")),
      row("Personnel", (c.personalNames ?? []).join(", ")),
      row("Groupe", (c.groupNames ?? []).join(", ")),
      row("Remarque", c.notes),
      c.virtualClassrooms?.length
        ? row("Classe virtuelle", h("span", {}, c.virtualClassrooms.map((u) => h("a", { href: u, target: "_blank", rel: "noreferrer" }, "Rejoindre "))))
        : null,
    ),
    resource?.contents?.length
      ? h("section", { class: "detail-section" },
          h("h3", {}, "Contenu du cours"),
          resource.contents.map((ct) =>
            h("div", { class: "content-block" },
              h("div", { class: "subject" }, ct.title || ct.categoryText || "Contenu"),
              ct.description ? h("div", { class: "desc" }, htmlToText(ct.description)) : null,
              ct.files?.length ? h("div", { class: "files" }, ct.files.map((f) => fileLink(f))) : null,
            ),
          ),
        )
      : null,
    dueThatDay.length
      ? h("section", { class: "detail-section" }, h("h3", {}, "Devoirs pour ce cours"), h("ul", { class: "list" }, dueThatDay.map((a) => homeworkItem(a))))
      : null,
    givenThatDay.length
      ? h("section", { class: "detail-section" }, h("h3", {}, "Devoirs donnés pendant ce cours"), h("ul", { class: "list" }, givenThatDay.map((a) => homeworkItem(a, { showDate: true }))))
      : null,
  ]);
}
