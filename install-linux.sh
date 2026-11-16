#!/usr/bin/env bash

if ! sudo -v; then
  echo "Could not get enough previledges to run the installator"
  exit 87
fi

# verify the package manager
if ! command -v pacman &> /dev/null && ! command -v apt &> /dev/null && ! command -v dnf &> /dev/null;
then
  echo "no package manager found, if not happy maybe: modify this script and add a pull request!"
  exit 1
fi

# verify if a package is installed
is_package_installed() {
  # check for arch
  if command -v pacman &> /dev/null
  then
    pacman -Q "$1" &> /dev/null
  elif command -v apt &> /dev/null
  then
    apt list --installed "$1" &> /dev/null
  elif command -v dnf  &> /dev/null
  then
    dnf list installed "$1" &> /dev/null
  fi
  return "$?"
}

# install a package
install_pkg() {
   # check for arch
  if command -v pacman &> /dev/null
  then
    sudo pacman -S --needed "$1"
  elif command -v apt &> /dev/null
  then
    sudo apt install "$1"
  elif command -v dnf  &> /dev/null
  then
    sudo dnf install "$1"
  fi
  return "$?"
}

LIBFUSEPKG="unreachable"
if command -v pacman &> /dev/null
then
  echo "package manager pacman detected"
  LIBFUSEPKG="fuse2"
elif command -v apt &> /dev/null
then
  echo "package manager apt detected"
  LIBFUSEPKG="fuse fuse-libs"
elif command -v dnf  &> /dev/null
then
  echo "package manager dnf detected"
  LIBFUSEPKG="libfuse2"
fi

if ! is_package_installed "$LIBFUSEPKG"; then
  echo "package libfuse not installed, downloading..."
  if ! install_pkg "$LIBFUSEPKG"; then
    echo "installation refused"
    exit 1
  fi
else
  echo "package libfuse already installed"
fi

# now download the latest release
REPO="AnCarsenat/repronote"
FILE="repronote-0.1.0-linux-x86_64.AppImage"
curl -LO "https://github.com/$REPO/releases/latest/download/$FILE"

# make file executable
chmod +x "$FILE"

# run it
"./$FILE"

