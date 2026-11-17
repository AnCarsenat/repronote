// "Plugins": a page listing optional tools; each opens at #/plugins/<id>.
// #/plugins/_github: community plugins from GitHub.
import { h } from "../lib.js";
import { allPlugins, findPlugin } from "../plugins/index.js";
import { renderStore, installedActions, KINDS, TOPIC } from "../plugins/github.js";

const icon = (d) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
};

const routeId = () => /^#\/plugins\/([\w-]+)/.exec(location.hash)?.[1] ?? "";

/** The plugin in the URL (#/plugins/<id>), if any. */
export const currentPlugin = () =>
  routeId() === "_github" ? { title: KINDS.plugin.title } : routeId() === "_github-widgets" ? { title: KINDS.widget.title } : findPlugin(routeId());

const back = () => h("a", { class: "button secondary small-btn", href: "#/plugins" }, "← Plugins");

// An installed plugin's page is kept across re-renders: re-creating it would
// reload its sandboxed frame (and lose what the user was doing in it).
const pages = new Map();

function githubPage(plugin, data, rerender) {
  const head = h("div", { class: "plugin-head" }, back(), h("h2", {}, plugin.title), h("span", { class: "sh-spacer" }), installedActions(plugin.github, rerender));
  const body = plugin.render(data, rerender);
  let page = pages.get(plugin.id);
  if (!page || page.lastElementChild !== body) {
    page = h("div", { class: "plugin-page" }, head, body);
    pages.set(plugin.id, page);
  } else page.firstElementChild.replaceWith(head);
  return page;
}

export default {
  id: "plugins",
  title: "Plugins",

  render(data, rerender) {
    const id = routeId();
    if (id === "_github" || id === "_github-widgets") {
      const kind = id === "_github" ? "plugin" : "widget";
      return [h("div", { class: "plugin-head" }, back(), h("h2", {}, `${KINDS[kind].title} (GitHub)`)), renderStore(kind, rerender)];
    }
    const plugin = findPlugin(id);
    if (plugin?.github) return githubPage(plugin, data, rerender);
    if (plugin) {
      return [
        h("div", { class: "plugin-head" }, back(), h("h2", {}, plugin.title)),
        plugin.render(data, rerender),
      ];
    }
    return [
      h("section", { class: "plugins-intro" },
        h("div", {},
          h("h2", {}, "Plugins"),
          h("p", { class: "muted" }, "Des outils en plus, à ouvrir quand vous en avez besoin. Tout reste sur votre appareil.")),
        h("div", { class: "sh-actions" },
          h("a", { class: "button", href: "#/plugins/_github" }, "＋ Installer un plugin (GitHub)"),
          h("a", { class: "button secondary", href: "#/plugins/_github-widgets" }, "＋ Installer un widget (GitHub)"))),
      h("ul", { class: "plugin-grid" },
        allPlugins().map((p) =>
          h("li", {},
            h("a", { class: "card plugin-card", href: `#/plugins/${p.id}` },
              h("span", { class: "plugin-icon" }, icon(p.icon)),
              h("span", { class: "plugin-text" },
                h("strong", {}, p.title, p.github ? h("span", { class: "tag" }, "GitHub") : null),
                h("span", { class: "muted small" }, p.description)),
              h("span", { class: "plugin-go", "aria-hidden": "true" }, "→"))))),
      h("p", { class: "muted small plugins-foot" },
        `Vous développez ? Publiez un plugin (sujet « ${TOPIC} ») ou un widget (sujet « ${KINDS.widget.topic} ») sur GitHub : il apparaîtra ici.`),
    ];
  },
};
