# Écrire un plugin ou un widget repronote

Deux sortes d'extensions, publiées sur GitHub :

| | Plugin | Widget |
|---|---|---|
| Où il s'affiche | une page dans **Plugins** | une carte sur l'**accueil** |
| Sujet (topic) du dépôt GitHub | `repronote-plugin` | `repronote-widget` |
| Manifeste à la racine | `repronote-plugin.json` | `repronote-widget.json` |
| Exemple | [`examples/plugin-heures`](../examples/plugin-heures) | [`examples/widget-vacances`](../examples/widget-vacances) |

Les utilisateurs les trouvent dans **Plugins → Installer un plugin / un widget (GitHub)**, ou en collant l'adresse du dépôt.

## 1. Le manifeste

```json
{
  "name": "Heures par matière",
  "description": "Combien d'heures de cours par matière, avec export CSV.",
  "version": "1.0.0",
  "entry": "plugin.js",
  "permissions": ["timetable", "download"],
  "icon": "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2"
}
```

| Champ | |
|---|---|
| `name` | obligatoire, 60 caractères max |
| `description` | une phrase, 200 caractères max |
| `version` | affichée à l'installation |
| `entry` | le fichier JavaScript du dépôt à exécuter (500 ko max), par défaut `plugin.js` |
| `permissions` | les données que le plugin reçoit (voir plus bas). L'utilisateur les voit et les accepte avant d'installer |
| `icon` | facultatif : le chemin d'un SVG 24×24 (attribut `d`), affiché dans la liste des plugins |

### Permissions

| Permission | Données reçues dans `repronote.data` |
|---|---|
| `user` | `user` : nom, classe, établissement |
| `timetable` | `timetable` (cours), `holidays` (vacances), `schoolYear` |
| `homework` | `homework` |
| `grades` | `grades` (`periods`, `byPeriod[id].grades`, `subjectsAverages`) |
| `news` | `news` (`items`) |
| `notebook` | `notebook` (absences, retards, punitions, observations) |
| `documents` | `documents` (liste des documents et bulletins, pas les fichiers) |
| `download` | le droit d'appeler `repronote.download(...)` |

Les données suivent les types de [pawnote](https://github.com/BlocksHub/Pawnote-LTS), avec les dates en texte ISO. Pour voir à quoi elles ressemblent : `curl -s localhost:4173/api/state | jq '.data.timetable.data[0]'`, ou des données inventées avec `node scripts/demo-data.mjs`.

## 2. Le code

Le fichier `entry` s'exécute dans un **Worker** (pas de page, pas de `document`), avec un objet global `repronote`. On affiche en donnant du HTML à `repronote.render(...)`, et on réagit aux clics avec `data-action` :

```js
let compteur = 0;

function afficher(data) {
  const cours = (data.timetable ?? []).filter((c) => !c.canceled);
  // html`…` échappe chaque ${valeur} : les données ne peuvent pas injecter de HTML.
  repronote.render(repronote.html`
    <div class="card">
      <p>${cours.length} cours synchronisés</p>
      <button data-action="plus">Cliqué ${compteur} fois</button>
    </div>`);
}

repronote.on("plus", () => {
  compteur++;
  afficher(repronote.data);
});

// Appelé au démarrage puis à chaque synchronisation, avec les données autorisées.
repronote.onUpdate(afficher);
```

| API | |
|---|---|
| `repronote.onUpdate(fn)` | `fn(data)` au démarrage et quand les données changent |
| `repronote.data` | les dernières données reçues |
| `repronote.permissions` | les permissions accordées |
| `repronote.render(html)` | remplace ce qui est affiché. `html` : une chaîne ou le résultat de `repronote.html` |
| `` repronote.html`…${valeur}…` `` | gabarit qui échappe les valeurs (les tableaux sont joints, un `repronote.html` imbriqué est gardé tel quel) |
| `repronote.escape(texte)` | échappe un texte pour du HTML |
| `repronote.on(nom, fn)` | `fn(event)` quand un élément `data-action="nom"` est cliqué (boutons, liens, cartes…) ou modifié (`input`, `select`, `textarea` : événements `input` et `change`) |
| `repronote.storage.get()` / `repronote.storage.set(valeur)` | une valeur JSON à vous (900 ko max), gardée sur le serveur repronote de l'utilisateur |
| `repronote.download(nom, type, contenu)` | propose un fichier texte à télécharger (CSV, ICS…) — permission `download` |

`event` contient `type` (`click`, `input`, `change`), `action`, `dataset` (les attributs `data-*` de l'élément), `value`, `checked`, et `values` : la valeur de chaque champ de la zone qui a un attribut `name`. Donnez un `id` aux champs : le texte en cours de frappe et le curseur sont gardés quand vous ré-affichez.

Le style de l'application est déjà là : variables CSS (`--bg`, `--card`, `--text`, `--muted`, `--border`, `--accent`, `--accent-text`, `--good`, `--bad`, `--radius`), classes `card`, `muted`, boutons et tableaux mis en forme, thème clair ou sombre. Les attributs `style` et les balises `<style>` sont permis. La hauteur du cadre suit votre contenu.

**Ce que le HTML peut contenir :** les balises de texte, listes, tableaux, `img` (en `data:` seulement), `details`, champs de formulaire et boutons, SVG simple. Le reste est retiré à l'affichage : scripts, attributs `on…`, `iframe`, `form`, `meta`, et les adresses des liens (`href`) — un lien ne peut pas ouvrir de page.

## 3. Le bac à sable : ce qui est interdit

Le code d'un plugin vient de quelqu'un d'autre ; repronote le fait tourner dans un Worker, à l'intérieur d'un `<iframe sandbox="allow-scripts">` dont la politique de sécurité n'autorise aucun accès réseau :

- **pas d'Internet** : `fetch`, `WebSocket`, `importScripts`, images externes, formulaires, liens et navigation sont bloqués. Tout doit être dans votre fichier (les images en `data:`) ;
- **pas d'accès à repronote** : ni à sa page, ni à ses cookies, ni à son API locale, ni au `localStorage` ;
- **seulement les données autorisées**, et rien ne peut sortir de l'appareil.

Bonnes pratiques : construisez le HTML avec `repronote.html` (jamais en collant des données dans une chaîne), gérez les données absentes (`data.timetable ?? []`), restez léger.

## 4. Publier

1. Créez un dépôt GitHub public avec le manifeste et le fichier `entry` à la racine (copiez un exemple de [`examples/`](../examples)).
2. Ajoutez le **sujet** `repronote-plugin` ou `repronote-widget` (page du dépôt → ⚙ à côté de « About » → Topics).
3. C'est tout : il apparaît dans repronote. L'installation est figée sur le commit du moment ; les utilisateurs cliquent « Mettre à jour » pour prendre votre dernière version.

Pour tester sans publier : installez-le depuis son adresse (`propriétaire/dépôt`) dans la même page — le sujet n'est pas obligatoire pour ça.
