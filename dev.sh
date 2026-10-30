#!/bin/sh
# Runs a nested GNOME Shell in a window to preview the extension.
# Needs mutter-devkit (sudo apt install mutter-dev-bin). The nested shell has
# no built-in backlight, but its own ddcutil-service controls the real monitors.
set -eu
exec dbus-run-session gnome-shell --devkit 2>&1 | grep --line-buffered -iE 'brightness-settings|JS ERROR'
