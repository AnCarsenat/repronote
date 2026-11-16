# repronote

Une interface alternative pour **Pronote**, qui tourne sur votre ordinateur.

- Fonctionne **hors ligne** : tout est gardé localement (SQLite) et synchronisé en arrière-plan.
- **Accueil modulaire** : widgets à ajouter, régler, déplacer entre colonnes — et facile d'écrire les siens.
- **Tout Pronote** : emploi du temps (avec les trous, détails des cours), devoirs à cocher, notes avec moyennes calculées (coefficients, bonus, préréglages bac/brevet), contenus de cours, carnet (absences, retards, punitions), informations, documents (casier, tous les bulletins), mes données.
- **Connexion par l'ENT** dans un vrai navigateur : ni mot de passe ni jeton enregistrés.
- **API HTTP locale** pour brancher vos propres outils.

> Projet indépendant, non affilié à Index Éducation. À utiliser avec votre propre compte.

*English: an alternative, offline-first Pronote frontend with a local HTTP API. Login goes through your school's ENT in a real browser; the live session is handed to [pawnote](https://github.com/BlocksHub/Pawnote-LTS). UI in French.*

## Installation

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
```

Les connexions suivantes se font **en arrière-plan** tant que la session ENT est valide (cookies gardés dans un profil Chromium dédié). Quand l'ENT redemande le mot de passe, la fenêtre se rouvre (le mot de passe enregistré par Chromium est validé automatiquement).

## Comment ça marche

Pronote 2026 a cassé la connexion par jeton des bibliothèques existantes. repronote se connecte donc **dans un vrai navigateur** (Playwright + Chromium), laisse l'ENT/CAS faire son travail, puis **reprend la session ouverte** dans la page (identifiant, clés AES, compteur de requêtes) et la confie à pawnote. La page est figée avant la reprise pour qu'elle n'envoie plus rien.

Quelques données que pawnote ne sait pas (ou plus) lire sont récupérées directement :

| Donnée | Méthode |
|---|---|
| Documents, bulletins | requête Pronote `Casier` (onglet 103), PDF via `GenerationPDF` |
| Informations | liste via `PageActualites` ; textes récupérés par la page Pronote elle-même au moment de la connexion |
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
| GET | `/api/export` | Toutes les données en un fichier JSON |

Exemple :

```sh
curl -s localhost:4173/api/state | jq '.data.homework.data[] | {matiere: .subject.name, pour: .deadline, fait: .done}'
```

Les données suivent les types de [pawnote](https://github.com/BlocksHub/Pawnote-LTS) (dates en ISO).

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
  store/       base SQLite, synchronisation, cache de fichiers
  server.ts    serveur HTTP + API
  cli/         npm run login / homework
web/
  views/       pages (accueil, emploi du temps, devoirs, notes…)
  widgets/     widgets de l'accueil
```

`npm run typecheck` vérifie les types (Node exécute le TypeScript directement).

## Licence

GPL-3.0-or-later (comme pawnote, dont deux décodeurs sont adaptés).
