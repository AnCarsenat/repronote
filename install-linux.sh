#!/usr/bin/env bash
# Installs the latest repronote on Linux, for every user, with an applications-menu entry.
#
#   curl -fsSL https://github.com/AnCarsenat/repronote/releases/latest/download/install-linux.sh | bash
#
# Two versions:
#   --app      the desktop application (AppImage, nothing else needed)       -> /usr/local/bin/repronote
#   --server   the local server, used in your web browser (needs Node.js ≥ 24
#              and Chromium/Chrome for the login)                            -> /opt/repronote-server
#              add --autostart to start it with your session (keeps notifications and webhooks running)
#   PREFIX=~/.local OPT_DIR=~/.local/opt bash install-linux.sh …   installs for you only, without sudo
#   --dev      the development version (pre-release rebuilt from the dev branch) instead of the stable one
# Without a choice, the script asks (or installs the app when it can't ask).
# Run it again to update (or `repronote-server --update` for the server).
#   --uninstall   removes both
set -euo pipefail

REPO="AnCarsenat/repronote"
# PREFIX / OPT_DIR can be changed (e.g. PREFIX=~/.local for a per-user install without sudo).
PREFIX="${PREFIX:-/usr/local}"
OPT_DIR="${OPT_DIR:-/opt}"
APP_BIN="$PREFIX/bin/repronote"
SERVER_DIR="$OPT_DIR/repronote-server"
SERVER_BIN="$PREFIX/bin/repronote-server"
APPS="$PREFIX/share/applications"
ICON="$PREFIX/share/icons/hicolor/512x512/apps/repronote.png"
UNIT="$HOME/.config/systemd/user/repronote.service"

mode=""
autostart=""
channel="stable"
for arg in "$@"; do
  case "$arg" in
    --app) mode="app" ;;
    --server) mode="server" ;;
    --autostart) autostart="yes" ;;
    --no-autostart) autostart="no" ;;
    --uninstall) mode="uninstall" ;;
    --dev) channel="dev" ;;
    --stable) channel="stable" ;;
    -h|--help) sed -n '2,15p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Option inconnue : $arg (voir --help)" >&2; exit 2 ;;
  esac
done

# sudo only when the install folders aren't writable by you.
SUDO=""
for d in "$PREFIX" "$OPT_DIR"; do
  mkdir -p "$d" 2>/dev/null || true
  [[ -w "$d" ]] || SUDO="sudo"
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { echo "Erreur : $*" >&2; exit 1; }
# Questions read the terminal even when the script comes from `curl … | bash`.
ask() {
  local answer=""
  # /dev/tty can exist but fail to open (no controlling terminal: cron, CI, IDE
  # tasks, Claude Code's `!`): then keep the default answer, without an error.
  if { exec 3</dev/tty; } 2>/dev/null; then
    read -r -u 3 -p "$1" answer || true
    exec 3<&-
  fi
  printf '%s' "$answer"
}

if [[ "$mode" == "uninstall" ]]; then
  if [[ -f "$UNIT" ]]; then
    systemctl --user disable --now repronote.service 2>/dev/null || true
    rm -f "$UNIT"
  fi
  "$SERVER_BIN" --stop 2>/dev/null || true
  $SUDO rm -rf "$APP_BIN" "$SERVER_BIN" "$SERVER_DIR" "$APPS/repronote.desktop" "$APPS/repronote-server.desktop" "$ICON"
  say "repronote a été désinstallé. Vos données restent dans ~/.config/repronote (application) et ~/.local/share/repronote (serveur)."
  exit 0
fi

if [[ -z "$mode" ]]; then
  echo "Quelle version installer ?"
  echo "  1) L'application (recommandé : rien d'autre à installer)"
  echo "  2) Le serveur, utilisé dans votre navigateur (demande Node.js ≥ 24 et Chromium)"
  case "$(ask "Votre choix [1] : ")" in
    2) mode="server" ;;
    *) mode="app" ;;
  esac
fi

[[ "$(uname -m)" == "x86_64" || "$mode" == "server" ]] || die "l'application n'existe que pour Linux x86_64 ; essayez --server."

# Server prerequisites, checked before asking for sudo.
if [[ "$mode" == "server" ]]; then
  command -v node >/dev/null || die "Node.js n'est pas installé (il faut la version 24 ou plus : https://nodejs.org ou le gestionnaire de paquets de votre distribution)."
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  (( node_major >= 24 )) || die "Node.js $(node -v) est trop ancien : il faut la version 24 ou plus."
  command -v npm >/dev/null || die "npm est introuvable (il est normalement installé avec Node.js)."
  chromium=""
  for c in chromium chromium-browser google-chrome-stable google-chrome; do
    if command -v "$c" >/dev/null; then chromium="$(command -v "$c")"; break; fi
  done
  [[ -n "$chromium" ]] || echo "Attention : Chromium/Chrome introuvable. Installez-le : la connexion à l'ENT se fait dans une fenêtre Chromium."
  if [[ -z "$autostart" ]] && command -v systemctl >/dev/null; then
    [[ "$(ask "Démarrer le serveur avec votre session (notifications et webhooks même navigateur fermé) ? [o/N] : ")" =~ ^[oOyY] ]] && autostart="yes"
  fi
fi

if [[ -n "$SUDO" ]]; then
  say "Les droits administrateur sont nécessaires pour installer dans $PREFIX et $OPT_DIR."
  if ! { exec 3</dev/tty; } 2>/dev/null; then
    die "pas de terminal pour demander le mot de passe administrateur. Lancez la commande dans un terminal, ou installez pour vous seul : PREFIX=~/.local OPT_DIR=~/.local/opt (voir le README)."
  fi
  exec 3<&-
  sudo -v || die "impossible d'obtenir les droits administrateur."
fi

# The file names contain the version: read them from the release (stable: the
# latest release; dev: the rolling "dev" pre-release).
if [[ "$channel" == "dev" ]]; then API_URL="https://api.github.com/repos/$REPO/releases/tags/dev"; else API_URL="https://api.github.com/repos/$REPO/releases/latest"; fi
RELEASE_JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API_URL")" || die "impossible de lire la dernière version sur GitHub."
TAG="$(printf '%s' "$RELEASE_JSON" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
VERSION="$(printf '%s' "$RELEASE_JSON" | grep -o '"name": *"[^"]*"' | head -1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+\(-dev\.[0-9]\+\)\?' || true)"
VERSION="${VERSION:-${TAG#v}}"
[[ -n "$TAG" ]] || die "impossible de trouver la dernière version."
asset_url() { printf '%s' "$RELEASE_JSON" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"$/\1/' | grep -E "$1" | head -1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
download() { # pattern, local name
  local url
  url="$(asset_url "$1")"
  [[ -n "$url" ]] || die "fichier introuvable dans la version $VERSION ($1)."
  curl -fL --progress-bar -o "$TMP/$2" "$url"
}

curl -fsSL -o "$TMP/icon.png" "https://raw.githubusercontent.com/$REPO/$TAG/build/icon.png" || true
if [[ -s "$TMP/icon.png" ]]; then $SUDO install -Dm644 "$TMP/icon.png" "$ICON"; fi
$SUDO install -d "$APPS"

desktop_entry() { # file, name, comment, exec
  $SUDO tee "$APPS/$1" >/dev/null <<ENTRY
[Desktop Entry]
Type=Application
Name=$2
Comment=$3
Exec=$4
Icon=repronote
Terminal=false
Categories=Education;
ENTRY
}

if [[ "$mode" == "app" ]]; then
  FILE="repronote.AppImage"
  say "Téléchargement de l'application repronote $VERSION…"
  download '\.AppImage$' "$FILE"
  $SUDO install -Dm755 "$TMP/$FILE" "$APP_BIN"
  desktop_entry repronote.desktop "repronote" "Une interface alternative pour Pronote" "$APP_BIN %U"
  done_msg="repronote $VERSION est installé. Lancez-le depuis le menu des applications ou avec la commande « repronote »."
else
  FILE="repronote-server.zip"
  say "Téléchargement du serveur repronote $VERSION…"
  download '/repronote-server-[^/]*\.zip$' "$FILE"
  mkdir "$TMP/x"
  if command -v unzip >/dev/null; then unzip -q "$TMP/$FILE" -d "$TMP/x"
  elif command -v python3 >/dev/null; then python3 -m zipfile -e "$TMP/$FILE" "$TMP/x"
  else die "il faut unzip (ou python3) pour extraire l'archive."; fi
  say "Installation des dépendances (npm)…"
  (cd "$TMP/x/repronote-server" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
  "$SERVER_BIN" --stop 2>/dev/null || true
  $SUDO rm -rf "$SERVER_DIR"
  $SUDO cp -r "$TMP/x/repronote-server" "$SERVER_DIR"
  $SUDO chmod -R a+rX "$SERVER_DIR"

  # Launcher: starts the server in the background if needed, then opens the browser.
  $SUDO install -d "$(dirname "$SERVER_BIN")"
  chromium_line=""
  [[ -z "$chromium" ]] || chromium_line="export CHROMIUM_PATH=\"\${CHROMIUM_PATH:-$chromium}\""
  $SUDO tee "$SERVER_BIN" >/dev/null <<LAUNCHER
#!/usr/bin/env bash
# repronote (server): repronote-server [--foreground | --stop | --update]
set -euo pipefail
export REPRONOTE_PLATFORM=server-installed
export REPRONOTE_CHANNEL="\${REPRONOTE_CHANNEL:-$channel}"
export REPRONOTE_DATA_DIR="\${REPRONOTE_DATA_DIR:-\${XDG_DATA_HOME:-\$HOME/.local/share}/repronote}"
export PORT="\${PORT:-4173}"
$chromium_line
STATE="\${XDG_STATE_HOME:-\$HOME/.local/state}/repronote"
URL="http://localhost:\$PORT"
mkdir -p "\$REPRONOTE_DATA_DIR" "\$STATE"
running() { curl -fsS -o /dev/null "\$URL/api" 2>/dev/null; }
case "\${1:-}" in
  --foreground) exec node "$SERVER_DIR/dist/server.mjs" ;;
  --stop)
    if [[ -f "\$STATE/server.pid" ]]; then kill "\$(cat "\$STATE/server.pid")" 2>/dev/null || true; rm -f "\$STATE/server.pid"; fi
    exit 0 ;;
  --update)
    # Same installer, same choices (server, channel); the server restarts after.
    if [[ "\$REPRONOTE_CHANNEL" == dev ]]; then from=download/dev; flag=--dev; else from=latest/download; flag=; fi
    curl -fsSL "https://github.com/$REPO/releases/\$from/install-linux.sh" | bash -s -- --server --no-autostart \$flag
    systemctl --user try-restart repronote.service 2>/dev/null || true
    exit 0 ;;
esac
if ! running; then
  nohup node "$SERVER_DIR/dist/server.mjs" >>"\$STATE/server.log" 2>&1 &
  echo \$! >"\$STATE/server.pid"
  for _ in \$(seq 1 50); do running && break; sleep 0.2; done
  running || { echo "Le serveur n'a pas démarré, voir \$STATE/server.log" >&2; exit 1; }
fi
xdg-open "\$URL" >/dev/null 2>&1 || echo "repronote : \$URL"
LAUNCHER
  $SUDO chmod 755 "$SERVER_BIN"
  desktop_entry repronote-server.desktop "repronote (serveur)" "Une interface alternative pour Pronote, dans votre navigateur" "$SERVER_BIN"

  if [[ "$autostart" == "yes" ]]; then
    mkdir -p "$(dirname "$UNIT")"
    cat >"$UNIT" <<SERVICE
[Unit]
Description=repronote (serveur local Pronote)
After=network-online.target

[Service]
ExecStart=$SERVER_BIN --foreground
Restart=on-failure

[Install]
WantedBy=default.target
SERVICE
    systemctl --user daemon-reload
    systemctl --user enable --now repronote.service
    say "Le serveur démarrera avec votre session."
  fi
  done_msg="repronote $VERSION (serveur) est installé. Lancez « repronote (serveur) » depuis le menu des applications, ou la commande « repronote-server » : l'interface s'ouvre dans votre navigateur (http://localhost:4173)."
fi

command -v update-desktop-database >/dev/null && $SUDO update-desktop-database -q "$APPS" || true
say "C'est fait : $done_msg"
