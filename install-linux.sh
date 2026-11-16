#!/usr/bin/env bash

if ! sudo -v; then
  echo "Could not get enough previledges to run the installator"
  exit 87
fi

# now download the latest release
echo "downloaded lastest AppImage release"

REPO="AnCarsenat/repronote"
FILE="repronote-0.1.0-linux-x86_64.AppImage"
curl -LO "https://github.com/$REPO/releases/latest/download/$FILE"

# make file executable
chmod +x "$FILE"

echo "Installing lastest release"

# install it
INSTALLED="/usr/local/bin/repronote"
sudo install -m 755 "$FILE" "$INSTALLED"

if [[ "$?" != 0 ]]; then 
  echo "Error: installation failed"
fi

echo "remove temp file"

# remove the downloaded file
rm "$FILE"

echo "done: repronote is now installed, use the `repronote` command in a terminal to lauch it"
