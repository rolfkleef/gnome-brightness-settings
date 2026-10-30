# Display Settings Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GNOME Shell 50 extension with a "Display settings" Quick Settings tile (built-in + external brightness sliders, Dark Style switch, Save desk setup / Restore buttons, saved-value marks) and a "Restore display settings?" notification on desk change.

**Architecture:** Pure logic (desk key, profile diff, write coalescing) lives in shell-independent modules unit-tested with plain `gjs -m`. Shell-facing modules wrap ddcutil-service (async D-Bus), `Main.brightnessManager` (built-in), and GSettings (style); `menu.js` renders the tile; `extension.js` wires desk changes to the notification.

**Tech Stack:** GJS ESM, GNOME Shell 50 Quick Settings API, `com.ddcutil.DdcutilService` D-Bus, Gio/GLib.

**Spec:** `docs/superpowers/specs/2026-10-30-display-settings-extension-design.md`

## Global Constraints

- UUID `display-settings@drostan.org`; `shell-version: ["50"]`.
- Tile and menu header title: `Display settings`. Notification: title `Restore display settings?`, action `Restore`. Buttons: `Save desk setup`, `Restore` / `Restore (N)`.
- Brightness VCP code `0x10`. Profiles: `~/.config/display-settings/desk-<key>.json`.
- Style values: `prefer-dark` (switch on) / `default` (switch off), key `org.gnome.desktop.interface color-scheme`.
- Built-in difference threshold: > 0.01 (relative); external: any raw-value difference.
- No synchronous D-Bus or file I/O on the shell's main loop.

## Review Focus

1. Unplugging/plugging monitors while the menu is open → sliders rebuild, no errors, no writes to departed monitors.
2. ddcutil-service missing or a monitor failing DDC → its slider is hidden, Restore skips it and still restores the rest, one notification names the failure.
3. Dragging an external slider quickly → only the last value is written once the drag ends (coalescing), no queue buildup.
4. Desk change to a desk with no profile, or a profile equal to current state → no notification.
5. Disabling the extension → GNOME's own brightness slider and Dark Style toggle reappear; no leftover signal handlers (enable/disable twice without errors in `journalctl /usr/bin/gnome-shell`).

Each is pinned in the owning task's verification steps below.

---

### Task 1: Repo, metadata, pure profile logic

**Files:**
- Create: `display-settings/metadata.json`, `display-settings/profile.js`, `display-settings/tests/profile.test.js`, `display-settings/Makefile`

**Interfaces:**
- Produces (`profile.js`, no shell imports, only `gi://GLib`/`gi://Gio`):
  - `deskKey(edids: string[]) -> string` — sha256 of `JSON.stringify([...edids].sort())`, first 20 hex chars.
  - `diffProfile(profile: Profile|null, state: State) -> {count: number, builtin: boolean, style: boolean, external: Set<string>}` where `Profile = {style: string, builtin: number|null, external: {[edid]: number}}` and `State` has the same shape; `profile === null` → count 0, nothing marked. EDIDs in state but not in profile are not differences.
  - `loadProfile(key) -> Promise<Profile|null>`, `saveProfile(key, profile) -> Promise<void>` (atomic: write `.tmp` then move; `Gio.File` async APIs; creates the directory).

- [ ] **Step 1: `git init display-settings`; write `metadata.json` (uuid, name "Display Settings", shell-version ["50"]) and a `Makefile` with `test: ; for f in tests/*.test.js; do gjs -m $$f || exit 1; done` and `install: ; ln -sfn $(CURDIR) ~/.local/share/gnome-shell/extensions/display-settings@drostan.org`.**
- [ ] **Step 2: Write failing tests** in `tests/profile.test.js` (plain asserts, throw on failure, print `ok`):
  - `deskKey(['b','a']) === deskKey(['a','b'])`, length 20, `deskKey([])` is stable.
  - `diffProfile(null, state).count === 0`.
  - builtin 0.50 vs 0.505 → not different; 0.50 vs 0.52 → different.
  - external `{e1: 100}` vs `{e1: 99}` → `external.has('e1')`, count 1.
  - style `default` vs `prefer-dark` → `style: true`; all three differ → count 3.
  - state edid `e2` absent from profile → not counted.
  - `saveProfile` then `loadProfile` round-trips with `XDG_CONFIG_HOME` pointed at a temp dir (set via `GLib.setenv` before import; profile path built with `GLib.get_user_config_dir()`).
- [ ] **Step 3: `make test` → fails (module missing).**
- [ ] **Step 4: Implement `profile.js`.**
- [ ] **Step 5: `make test` → `ok`.**
- [ ] **Step 6: Commit** `feat: profile key, diff and storage`.

### Task 2: Brightness backends

**Files:**
- Create: `display-settings/ddc.js`, `display-settings/writer.js`, `display-settings/builtin.js`, `display-settings/tests/writer.test.js`

**Interfaces:**
- Produces:
  - `writer.js`: `class CoalescingWriter { constructor(writeFn: (value) => Promise) ; set(value): void ; idle(): Promise }` — one write in flight, latest pending value wins, skips if equal to last written. No shell imports.
  - `ddc.js`: `class Ddc { async init() ; async detect() -> [{edid, name, displayId}] ; async get(edid) -> {value, max}|null ; set(edid, value): void ; destroy() }` — async proxy as in Multi Display Adjustment's `ddcutil-service.js` (Detect `a(iiisssqsu)`: [0]=display number, [4]=model, [5]=serial, [7]=EDID text). `name`: the matching `MetaMonitor.get_display_name()` (match on `get_product()`/`get_serial()` vs model/serial), fallback model. `get` returns null on DDC error. `set` uses one `CoalescingWriter` per EDID. ServiceUnknown → `detect()` returns `[]` and sets `ddc.unavailable = true`.
  - `builtin.js`: `class Builtin { get available(): boolean ; get value(): number ; set value(v: number) ; connect('changed') }` — wraps the `Main.brightnessManager.scales` entry whose monitor contains connector `eDP-1`; re-resolves on `monitors-changed`. Setting `value` assigns `scale.value` (shell then writes the backlight and OSD).
- [ ] **Step 1: Failing tests** in `tests/writer.test.js` with a fake async `writeFn` recording calls and resolving on demand: `set(1); set(2); set(3)` while first write pending → calls `[1, 3]`; `set(3)` again after idle → no new call; `await idle()` resolves after last write.
- [ ] **Step 2: `make test` → writer test fails.**
- [ ] **Step 3: Implement `writer.js`, then `ddc.js` and `builtin.js`.**
- [ ] **Step 4: `make test` → `ok`.**
- [ ] **Step 5: Smoke-check imports in a nested shell:** `make install`, then `dbus-run-session gnome-shell --devkit --wayland` with a throwaway `extension.js` logging `await ddc.detect()` and `builtin.value`; `journalctl --user -f` shows both monitors' EDIDs/names and a 0–1 value. (Nested shell may have no real backlight/DDC: if so, do this check in the real session after Task 4 instead and note it.)
- [ ] **Step 6: Commit** `feat: ddc and built-in brightness backends`.

### Task 3: Tile menu

**Files:**
- Create: `display-settings/menu.js`, `display-settings/stylesheet.css`

**Interfaces:**
- Consumes: `Ddc`, `Builtin`, `diffProfile`, `loadProfile`, `saveProfile`, `deskKey`.
- Produces: `class DisplaySettingsToggle extends QuickMenuToggle { constructor(ddc, builtin, settings) ; async refresh(): Promise ; get differences(): number ; async restore(): Promise<string[]> /* failures */ ; async save(): Promise ; destroy() }` plus `DisplaySettingsIndicator extends SystemIndicator` holding it.
- Layout (option B): header "Display settings"; built-in slider row (only if `builtin.available`), one row per external monitor (name label, slider, value); a saved-position mark (small yellow `St.Widget`, class `ds-saved-mark`, positioned at saved fraction of the slider width) on rows that differ; Dark Style row with `PopupSwitchMenuItem` plus yellow dot + "saved: on/off" label when style differs; a box with two `St.Button`s "Save desk setup" and "Restore"/"Restore (N)" (`ds-restore-active` when N>0, `reactive=false` when N=0).
- `refresh()` runs on menu open and after save/restore: re-detect if desk changed, read all values, load profile, recompute diff, update marks/labels/button. Toggle's checked state is unused (`toggle-mode` off; clicking opens menu).
- `restore()`: built-in via `builtin.value = saved`; externals via `ddc.set` then `await` writer idle; style via `settings.set_string`; then `refresh()`. Returns list of failed monitor names.
- [ ] **Step 1: Implement `menu.js` and `stylesheet.css`.**
- [ ] **Step 2: Temporary `extension.js` that only adds the indicator; `make install`; log out/in; `gnome-extensions enable display-settings@drostan.org`.**
- [ ] **Step 3: Verify manually:** tile titled "Display settings"; three sliders with correct names and values matching `ddcutil getvcp 10` and GNOME's own slider; moving built-in slider moves GNOME's slider; Dark Style switch flips the theme; Save writes `~/.config/display-settings/desk-*.json`; change two values → reopen menu → two marks, "Restore (2)"; Restore → values back, marks gone, GNOME slider shows restored value; rapid drag of an external slider → final value correct (Review Focus 3).
- [ ] **Step 4: Verify failure path:** `systemctl --user stop ddcutil-service` (or equivalent) → reopen menu → externals hidden, built-in still works, no shell errors (Review Focus 2).
- [ ] **Step 5: Commit** `feat: display settings tile`.

### Task 4: Desk-change notification, hiding GNOME's items, lifecycle

**Files:**
- Modify/Create: `display-settings/extension.js`

**Interfaces:**
- Consumes: `DisplaySettingsIndicator`, `DisplaySettingsToggle.refresh/differences/restore`.
- Behavior:
  - On `monitors-changed` (`global.backend.get_monitor_manager()`), debounce 5 s (`GLib.timeout_add_seconds`), then `toggle.refresh()`; if a profile exists and `differences > 0`, show a `MessageTray.Notification` (source title "Display settings", title `Restore display settings?`, action `Restore` → `toggle.restore()`); replace any earlier pending notification. If `restore()` returns failures, show one notification listing them.
  - Also check once on `enable()` (after the same delay).
  - Hide GNOME's built-in brightness item and Dark Style toggle: find them in `Main.panel.statusArea.quickSettings` (brightness: the item from `ui/status/brightness.js`, `_brightness` indicator's `quickSettingsItems`; dark mode: `_darkMode` indicator's items), set `visible = false`, restore in `disable()`.
  - `disable()`: remove timeout, destroy notification source, indicator, Ddc; disconnect all signals.
- [ ] **Step 1: Implement `extension.js`.**
- [ ] **Step 2: Reload (log out/in), verify:** GNOME's brightness slider and Dark Style tile are gone; unplug a monitor with a saved profile for the laptop-only desk that differs → notification after ~5 s; click Restore → applied and GNOME state consistent; plug back in → notification for the docked desk (Review Focus 1, also with menu open during unplug).
- [ ] **Step 3: Verify no-notification cases:** desk without profile, and desk whose profile equals current state → nothing shown (Review Focus 4).
- [ ] **Step 4: Verify lifecycle:** `gnome-extensions disable` → GNOME's items reappear; enable/disable twice; `journalctl --user -b /usr/bin/gnome-shell | grep -i display-settings` shows no errors (Review Focus 5).
- [ ] **Step 5: Commit** `feat: restore prompt on desk change`.

### Task 5: Switch over (each step confirmed with the user first)

- [ ] Disable `multi-display-adjustment@cecilio.xyz`.
- [ ] Remove the stub `~/.local/share/gnome-shell/extensions/desk-settings@drostan.org`.
- [ ] Remove `~/.local/bin/desk-settings` (backup already in the session scratchpad).
