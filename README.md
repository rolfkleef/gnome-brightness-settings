# Display Settings (GNOME Shell extension)

A "Displays" tile in Quick Settings with brightness sliders for the built-in
screen and external monitors (DDC/CI), a Dark Style switch, and per-desk
save and restore. It replaces GNOME's own brightness slider and Dark Style
toggle while enabled.

- **Save this setup** stores brightness of every display and the style for the
  current desk (the set of connected external monitors). Enabled only when
  something differs from the saved setup.
- Settings that differ from the saved setup show a yellow mark at the saved
  slider position (or a yellow dot with "saved: on/off" for Dark Style);
  displays not in the saved setup get a yellow dot before their name.
- **Restore (N)** applies the saved setup. When monitors are plugged in or
  unplugged and the new desk's saved setup differs, a "Restore display
  settings?" notification offers the same.

Profiles live in `~/.config/display-settings/desk-<key>.json`.

## Requirements
- GNOME Shell 50
- [ddcutil-service](https://github.com/digitaltrails/ddcutil-service) for external monitors

## Setup
`./install.sh`, log out and in, then `gnome-extensions enable display-settings@drostan.org`

## Development
- `tests/run.sh` runs the unit tests (desk key, profile diff and storage, write coalescing)
- `./dev.sh` opens a nested GNOME Shell to preview the tile; close the window to stop.
  It has no built-in backlight, and its sliders control the real external monitors.
- Changes to the extension load in the real session only after logging out and in (Wayland).
- Design and plan: `docs/superpowers/`
