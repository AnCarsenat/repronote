import { createEditor } from "../md-editor.js";

// A free note on the home screen, in simple Markdown styled as you type.
const SIZES = { small: "0.85rem", normal: "1rem", large: "1.2rem", xl: "1.5rem" };

export default {
  type: "note",
  title: "Note",
  description: "Un bloc-notes sur l'accueil, en Markdown simple (titres, gras, listes, cases à cocher), mis en forme pendant la frappe.",
  needs: [],
  defaults: { title: "", text: "", fontSize: "normal" },
  settings: [
    { key: "title", label: "Titre", type: "text", placeholder: "Note" },
    { key: "fontSize", label: "Taille du texte", type: "select", options: [
      { value: "small", label: "Petite" }, { value: "normal", label: "Normale" }, { value: "large", label: "Grande" }, { value: "xl", label: "Très grande" },
    ] },
  ],

  render(_data, settings, ctx) {
    const editor = createEditor(settings.text, (text) => ctx?.save({ text }), {
      id: ctx ? `note-${ctx.id}` : undefined,
      placeholder: "Écrivez ici… # titre, **gras**, - liste, - [ ] à faire",
      className: "note-editor",
    });
    editor.style.fontSize = SIZES[settings.fontSize] ?? SIZES.normal;
    return editor;
  },
};
