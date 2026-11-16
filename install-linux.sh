#!/usr/bin/env bash
# Installs the latest repronote AppImage for every user:
#   /usr/local/bin/repronote, plus an icon and an entry in the applications menu.
# Usage: curl -fsSL https://github.com/AnCarsenat/repronote/releases/latest/download/install-linux.sh | bash
#        (or: bash install-linux.sh --uninstall)
set -euo pipefail

REPO="AnCarsenat/repronote"
BIN="/usr/local/bin/repronote"
DESKTOP="/usr/local/share/applications/repronote.desktop"
ICON="/usr/local/share/icons/hicolor/512x512/apps/repronote.png"

if [[ "${1:-}" == "--uninstall" ]]; then
  sudo rm -f "$BIN" "$DESKTOP" "$ICON"
  echo "repronote a été désinstallé."
  exit 0
fi

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Erreur : seul Linux x86_64 est pris en charge pour l'instant." >&2
  exit 1
fi

echo "Les droits administrateur sont nécessaires pour installer dans /usr/local."
if ! sudo -v; then
  echo "Erreur : impossible d'obtenir les droits administrateur." >&2
  exit 87
fi

# The file name contains the version: find the latest one from the release redirect.
TAG="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
TAG="${TAG##*/}"
VERSION="${TAG#v}"
if [[ -z "$VERSION" || "$VERSION" == "latest" ]]; then
  echo "Erreur : impossible de trouver la dernière version." >&2
  exit 1
fi
FILE="repronote-$VERSION-linux-x86_64.AppImage"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Téléchargement de repronote $VERSION…"
curl -fL --progress-bar -o "$TMP/$FILE" "https://github.com/$REPO/releases/download/$TAG/$FILE"
curl -fsSL -o "$TMP/icon.png" "https://raw.githubusercontent.com/$REPO/$TAG/build/icon.png" || true

echo "Installation…"
sudo install -Dm755 "$TMP/$FILE" "$BIN"
if [[ -s "$TMP/icon.png" ]]; then
  sudo install -Dm644 "$TMP/icon.png" "$ICON"
fi
sudo install -d "$(dirname "$DESKTOP")"
sudo tee "$DESKTOP" >/dev/null <<DESKTOP_ENTRY
[Desktop Entry]
Type=Application
Name=repronote
Comment=Une interface alternative pour Pronote
Exec=$BIN %U
Icon=repronote
Terminal=false
Categories=Education;
DESKTOP_ENTRY
command -v update-desktop-database >/dev/null && sudo update-desktop-database -q "$(dirname "$DESKTOP")" || true

echo "C'est fait : repronote $VERSION est installé. Lancez-le depuis le menu des applications ou avec la commande « repronote »."
