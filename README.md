# repronote

Une interface alternative pour **Pronote**, qui tourne sur votre ordinateur.

- Fonctionne **hors ligne** : tout est gardé localement (SQLite) et synchronisé en arrière-plan.
- **Accueil modulaire** : widgets à ajouter, régler (largeur, hauteur avec défilement), déplacer entre colonnes — et facile d'écrire les siens.
- **Tout Pronote** : emploi du temps (avec les trous, détails des cours), devoirs à cocher (liste sans fin jusqu'à la fin de l'année), notes avec moyennes calculées (coefficients, bonus, préréglages bac/brevet), statistiques (évolution de la moyenne, matières, charge de travail), contenus de cours, carnet (absences, retards, punitions), informations (marquer comme lu, recherche), documents (casier, tous les bulletins), annuaire de l'établissement exportable, mes données.
- Boutons **« Ouvrir dans Pronote »** pour ce qui doit se faire sur le site (sondages, certificats…).
- **Connexion par l'ENT** dans un vrai navigateur : ni mot de passe ni jeton enregistrés.
- **API HTTP locale** pour brancher vos propres outils.

> Projet indépendant, non affilié à Index Éducation. À utiliser avec votre propre compte.

*English: an alternative, offline-first Pronote frontend with a local HTTP API. Login goes through your school's ENT in a real browser; the live session is handed to [pawnote](https://github.com/BlocksHub/Pawnote-LTS). UI in French.*

## Télécharger

Les versions prêtes à installer sont dans les [Releases](https://github.com/AnCarsenat/repronote/releases) :

| Fichier | Pour |
|---|---|
| `repronote-…-win-x64.exe` | Windows (installateur ; non signé : cliquez « Informations complémentaires » puis « Exécuter quand même ») |
| `repronote-…-linux-x86_64.AppImage` | Linux, toutes distributions (rendre exécutable puis lancer ; pas besoin de `fuse2`/`libfuse2`) |
| `repronote-…-linux-x64.tar.gz` | Linux sans AppImage : extraire puis lancer `./repronote` |
| `repronote-…-linux-amd64.deb` | Debian, Ubuntu, Mint… |
| `repronote-server-….zip` | Le serveur seul (Node ≥ 24 + Chromium), pour un serveur ou un Raspberry Pi |

Au premier lancement, collez l'adresse Pronote de votre établissement : une fenêtre s'ouvre pour vous connecter (ENT ou Pronote). Android viendra plus tard.

## Depuis les sources

Prérequis : **Node.js ≥ 24** et **Chromium** (ou Chrome).

```sh
git clone https://github.com/AnCarsenat/repronote.git
cd repronote
npm install
```

Si Chromium n'est pas dans `/usr/bin/chromium`, indiquez son chemin : `export CHROMIUM_PATH=/chemin/vers/chromium`.

## Utilisation

```sh
# 1. Première connexion : une fenêtre s'ouvre, connectez-vous via l'ENT.
npm run login -- https://XXXXXXXX.index-education.net/pronote/

# 2. L'interface : http://localhost:4173
npm run serve

# Ou en ligne de commande :
npm run homework

# L'application de bureau (Electron), depuis les sources :
npm run desktop
```

Les connexions suivantes se font **en arrière-plan** tant que la session ENT est valide (cookies gardés dans un profil Chromium dédié). Quand l'ENT redemande le mot de passe, la fenêtre se rouvre (le mot de passe enregistré par Chromium est validé automatiquement).

## Comment ça marche

Pronote 2026 a cassé la connexion par jeton des bibliothèques existantes. repronote se connecte donc **dans un vrai navigateur** (Playwright + Chromium), laisse l'ENT/CAS faire son travail, puis **reprend la session ouverte** dans la page (identifiant, clés AES, compteur de requêtes) et la confie à pawnote. La page est figée avant la reprise pour qu'elle n'envoie plus rien.

Quelques données que pawnote ne sait pas (ou plus) lire sont récupérées directement :

| Donnée | Méthode |
|---|---|
| Documents, bulletins | requête Pronote `Casier` (onglet 103), PDF via `GenerationPDF` |
| Informations | liste via `PageActualites` ; textes récupérés par la page Pronote elle-même au moment de la connexion ; « lu » via `SaisieActualites` (`genreSaisie: 0`) |
| Annuaire | requête `ListeRessourcesPourCommunication` ; e-mails via l'autocomplétion du webmail ENT (`psn.monlycee.net/address-book/contacts?filter=`), une recherche par personne de l'annuaire |
| Devoirs | archive locale de tous les devoirs de l'année (les identifiants Pronote changent à chaque session : clé stable matière + date + texte) |
| Fichiers | téléchargés via le serveur local et gardés dans `data/files` (les liens Pronote expirent avec la session) |

## Données et vie privée

Tout reste dans le dossier `data/` (ignoré par git) : base SQLite, profil Chromium (cookies ENT), fichiers. Le serveur écoute **uniquement sur localhost**. Pour l'exposer sur votre réseau : `HOST=0.0.0.0 npm run serve` — attention, toute personne du réseau pourrait alors lire vos données et agir en votre nom.

## API

Le serveur local expose une API JSON. `GET /api` en donne la liste.

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/api/state` | Tout : état de synchro, mise en page, réglages, et chaque jeu de données (`homework`, `timetable`, `grades`, `news`, `notebook`, `documents`, `resources`, `account`…) avec sa date de mise à jour |
| POST | `/api/sync` | Synchroniser maintenant (sans fenêtre) |
| POST | `/api/login` | Ouvrir la fenêtre de connexion puis synchroniser |
| POST | `/api/homework/:id/done` | Cocher / décocher un devoir — corps `{ "done": true }` (mis en file si hors ligne) |
| PUT | `/api/layout` | Mise en page de l'accueil — `{ "widgets": [{ "id", "type", "col", "size", "settings" }] }` |
| PUT | `/api/subject-settings` | Coefficients des matières — `{ "MATIÈRE": { "coef": 2, "mode": "normal" \| "bonus" \| "excluded" } }` |
| GET | `/api/file?id=&n=` | Pièce jointe (mise en cache) |
| GET | `/api/doc/casier?id=&n=` | Document du casier |
| GET | `/api/doc/bulletin?ident=&n=&period=&year=` | Bulletin en PDF |
| GET | `/api/homework/range?from=AAAA-MM-JJ&to=AAAA-MM-JJ` | Devoirs sur une période (120 jours max), en direct ou depuis l'archive locale |
| POST | `/api/news/read` | Marquer une information comme lue / non lue dans Pronote — `{ "key": "...", "read": true }` |
| GET | `/api/contacts` | Annuaire : professeurs (matières) et personnels (fonction) joignables par la messagerie. `/api/contacts.csv` pour un tableur |
| POST | `/api/contacts/emails` | Cherche l'adresse e-mail de chacun de ces professeurs/personnels avec l'autocomplétion du webmail de l'ENT (une fenêtre s'ouvre pour s'y connecter ; une recherche par personne, rien d'autre n'est lu) |
| GET | `/api/export` | Toutes les données en un fichier JSON |

Exemple :

```sh
curl -s localhost:4173/api/state | jq '.data.homework.data[] | {matiere: .subject.name, pour: .deadline, fait: .done}'
```

Les données suivent les types de [pawnote](https://github.com/BlocksHub/Pawnote-LTS) (dates en ISO).

## Assistant IA (MCP)

repronote expose ses données à un assistant IA via le [Model Context Protocol](https://modelcontextprotocol.io) : devoirs, emploi du temps, notes, informations, carnet, documents, et cocher un devoir ou marquer une information comme lue.

- **Clients HTTP** (Claude Code…) : `claude mcp add --transport http repronote http://127.0.0.1:4173/mcp`
- **Clients qui lancent une commande** (Claude Desktop…) : `npm run mcp` (ou `node dist/mcp.mjs` dans le paquet serveur), avec repronote lancé à côté. Exemple de configuration :
  ```json
  { "mcpServers": { "repronote": { "command": "node", "args": ["/chemin/vers/repronote/dist/mcp.mjs"] } } }
  ```

Outils : `get_today`, `get_timetable`, `get_homework`, `set_homework_done`, `get_grades`, `get_news`, `mark_news_read`, `get_notebook`, `get_lesson_contents`, `list_documents`, `sync_now`.

## Écrire un widget

Un widget est un module dans `web/widgets/`, à ajouter dans `web/widgets/index.js` :

```js
import { h, homeworkList } from "../lib.js";

export default {
  type: "compteur",
  title: "Compteur de devoirs",
  description: "Combien de devoirs il reste.",
  needs: ["homework"],                 // données lues
  defaults: { jours: 7 },
  settings: [{ key: "jours", label: "Nombre de jours", type: "number", min: 1, max: 30 }],
  render(data, settings) {             // ne lit que la copie locale : marche hors ligne
    const limite = Date.now() + settings.jours * 864e5;
    const n = homeworkList(data).filter((a) => !a.done && a.deadline < limite).length;
    return h("p", { class: "big" }, String(n));
  },
};
```

Il apparaît dans « + Ajouter un widget », avec ses réglages dans la roue ⚙. Les pièces communes sont dans `web/components.js` (devoir à cocher, cours, fenêtre) et `web/charts.js`.

## Structure

```
src/
  core/        connexion (navigateur, reprise de session), requêtes Pronote brutes
  electron/    application de bureau
  mcp/         serveur MCP (outils pour assistants IA)
  store/       base SQLite, synchronisation, cache de fichiers
  server.ts    serveur HTTP + API
  cli/         npm run login / homework
web/
  views/       pages (accueil, emploi du temps, devoirs, notes…)
  widgets/     widgets de l'accueil
```

`npm run typecheck` vérifie les types (Node exécute le TypeScript directement).

### Construire

| Commande | Produit |
|---|---|
| `npm run build` | `dist/server.mjs`, `dist/electron-main.mjs`, `dist/mcp.mjs` (esbuild) |
| `npm run dist:linux` | AppImage + .deb + .tar.gz dans `release/` |
| `npm run dist:win` | installateur Windows (sur Windows) |
| `npm run dist:server` | `release/repronote-server/` |

Le workflow GitHub `.github/workflows/build.yml` construit tout à chaque push ; un tag `v1.2.3` publie une Release avec les fichiers.

L'application de bureau lance le serveur dans Electron et utilise ses propres fenêtres pour la connexion (pas de Playwright) ; ses données sont dans le profil utilisateur (`~/.config/repronote/data`, `%APPDATA%\repronote\data`).

## Licence

GPL-3.0-or-later (comme pawnote, dont deux décodeurs sont adaptés).
