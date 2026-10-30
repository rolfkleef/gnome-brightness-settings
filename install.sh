#!/bin/sh
# Links the extension into the user's extension directory.
set -eu
cd "$(dirname "$0")"
uuid=brightness-settings@drostan.org
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
ln -sfn "$PWD/extension" "$HOME/.local/share/gnome-shell/extensions/$uuid"
echo "Installed $uuid. Log out and back in (Wayland), then: gnome-extensions enable $uuid"
