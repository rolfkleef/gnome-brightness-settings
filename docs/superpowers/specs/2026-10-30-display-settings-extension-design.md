# Display Settings — GNOME Shell extension

## Intent

One GNOME Shell extension replacing two things the user has today:

- `~/.local/bin/desk-settings` (Python): saves and restores, per desk, the dark/light
  style and the brightness of every display.
- Multi Display Adjustment (`multi-display-adjustment@cecilio.xyz`): a Quick Settings
  tile with DDC/CI brightness (and contrast) sliders for external monitors.

Why: the script runs outside the shell, so it cannot move GNOME's built-in brightness
slider (GNOME 50's BrightnessManager ignores Mutter's D-Bus `SetBacklight`), and the
third-party extension only reads DDC values when it builds its sliders, so the script
had to reload it after every restore. Inside the shell, both problems go away.

## Goals

- One Quick Settings tile titled **"Display settings"** (menu header too), containing:
  - a brightness slider for the built-in screen (eDP-1), bound to the shell's own
    `Main.brightnessManager` monitor scale, so GNOME's state, the OSD and the slider agree;
  - one brightness slider per external DDC/CI monitor, labelled with its name
    (same naming as Settings / the EDID monitor name);
  - a **Dark Style** switch (`org.gnome.desktop.interface color-scheme`:
    `prefer-dark` ↔ `default`);
  - two buttons side by side: **Save desk setup** and **Restore**.
- Difference from the saved profile is shown as in mockup option B:
  - each slider whose value differs shows a small yellow mark at its saved position;
  - the Dark Style row shows a yellow dot and "saved: on/off" when it differs;
  - Restore shows the count, e.g. "Restore (3)", highlighted; greyed out/insensitive
    when nothing differs or no profile exists for this desk.
- When the set of connected displays changes and a profile exists for the new desk
  **and it differs from the current state**, a notification asks
  **"Restore display settings?"** with a **Restore** action. Nothing changes without a click.
- Desk identity: the set of connected external monitors (by EDID), as in the script.
  One profile per desk.

## Non-goals

- Contrast, grouped "adjust all together", inline placement, preferences window.
- Automatic restore without confirmation.
- Migrating the script's existing profiles (user re-saves each desk once).
- Supporting GNOME versions other than 50.

## Anti-goals

- A restore that leaves any slider showing a stale value.
- Writing to monitors when the user only opens the menu.
- Freezing the shell: all DDC traffic is async.

## Constraints

- GNOME Shell 50, Wayland, ESM extension. UUID `display-settings@drostan.org`.
- External monitors via `com.ddcutil.DdcutilService` (already installed and running),
  VCP 0x10; DDC is slow, so writes are coalesced (one in flight per display, latest
  value wins) like Multi Display Adjustment does.
- Built-in brightness only through `Main.brightnessManager` scales (relative 0–1 of the
  backlight's min–max range).
- Profiles stored as JSON under `~/.config/display-settings/`.

## Decided by the user

- Single extension; confirmation notification text "Restore display settings?".
- Tile title "Display settings"; Dark Style switch inside it.
- Save and Restore as side-by-side buttons; diff option B.

## Calls made by Claude (check these)

- GNOME's own brightness slider and Dark Style toggle are **hidden** from Quick Settings
  while the extension is enabled (user asked for them to "move into the tile"); restored
  on disable.
- Diff tolerance: brightness differs when it is more than 1 percentage point off
  (avoids marks from rounding); external values compared as raw VCP.
- Monitors that are connected but not in the saved profile (can't happen with the
  desk key) or fail DDC reads are shown without a saved mark and skipped by Restore;
  failures reported via a notification.
- External values are re-read each time the menu opens (cheap enough, keeps diff honest
  when the monitor's own buttons were used).
- After it works: disable Multi Display Adjustment, delete the earlier helper stub at
  `~/.local/share/gnome-shell/extensions/desk-settings@drostan.org`, and remove
  `~/.local/bin/desk-settings`, each confirmed with the user first.

## Left to the builder

- File layout, styling details of marks and buttons, icon choice.
- Exact settle delay after monitors-changed before reading DDC (ddcutil needs a moment
  after hotplug).
