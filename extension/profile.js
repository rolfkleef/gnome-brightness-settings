// Per-desk profiles: which settings a desk has saved and how the current
// state differs from them. No shell imports, so it can be tested with gjs.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

// Relative built-in brightness closer than this counts as equal (rounding)
const BUILTIN_TOLERANCE = 0.01

Gio._promisify(Gio.File.prototype, 'load_contents_async')
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish')
Gio._promisify(Gio.File.prototype, 'move_async')

/**
 * A desk is the set of external monitors connected, by EDID.
 */
export function deskKey(edids) {
    const identity = JSON.stringify([...edids].sort())

    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, identity, -1).slice(0, 20)
}

/**
 * Profile and state: `{style, nightLight, keyboard, builtin, external: {edid: value}}`, with
 * `builtin` relative (0–1) or null. Only settings the profile holds count.
 */
export function diffProfile(profile, state) {
    const diff = {
        count: 0, builtin: false, style: false, nightLight: false, keyboard: false, external: new Set(),
        // Displays connected but not in the profile: nothing to restore, but worth saving
        unsaved: new Set(), builtinUnsaved: false,
        saveNeeded: true,
    }

    if (!profile)
        return diff

    diff.style = profile.style !== state.style
    diff.builtin = profile.builtin !== null && state.builtin !== null &&
        Math.abs(profile.builtin - state.builtin) > BUILTIN_TOLERANCE

    diff.builtinUnsaved = profile.builtin === null && state.builtin !== null

    // Profiles saved before night light was part of the setup don't hold it
    const savedNightLight = 'nightLight' in profile
    diff.nightLight = savedNightLight && profile.nightLight !== state.nightLight
    const nightLightUnsaved = !savedNightLight && state.nightLight !== undefined

    // Keyboard backlight (0–100), null when the laptop has none
    const savedKeyboard = profile.keyboard !== undefined && profile.keyboard !== null
    const hasKeyboard = state.keyboard !== undefined && state.keyboard !== null
    diff.keyboard = savedKeyboard && hasKeyboard && profile.keyboard !== state.keyboard
    const keyboardUnsaved = !savedKeyboard && hasKeyboard

    for (const [edid, value] of Object.entries(state.external)) {
        if (!(edid in profile.external))
            diff.unsaved.add(edid)
        else if (profile.external[edid] !== value)
            diff.external.add(edid)
    }

    diff.count = diff.style + diff.nightLight + diff.keyboard + diff.builtin + diff.external.size
    diff.saveNeeded = diff.count > 0 || diff.unsaved.size > 0 || diff.builtinUnsaved || nightLightUnsaved || keyboardUnsaved

    return diff
}

function profileFile(key) {
    return Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_config_dir(), 'brightness-settings', `desk-${key}.json`]))
}

export async function loadProfile(key) {
    try {
        const [contents] = await profileFile(key).load_contents_async(null)

        return JSON.parse(new TextDecoder().decode(contents))
    } catch (error) {
        if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return null
        throw error
    }
}

export async function saveProfile(key, profile) {
    const file = profileFile(key)
    const temporary = file.get_parent().get_child(`desk-${key}.json.tmp`)

    try {
        file.get_parent().make_directory_with_parents(null)
    } catch (error) {
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw error
    }

    const bytes = new GLib.Bytes(new TextEncoder().encode(`${JSON.stringify(profile, null, 2)}\n`))

    await temporary.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null)
    await temporary.move_async(file, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null)
}
