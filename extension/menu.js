// The "Displays" Quick Settings tile: brightness sliders for the
// built-in and external displays, the dark style switch, and saving and
// restoring them per desk. Settings that differ from the saved desk setup
// show a yellow mark at their saved value.

import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import St from 'gi://St'

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

import { QuickMenuToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js'
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js'

import { deskKey, diffProfile, loadProfile, saveProfile } from './profile.js'

const TITLE = 'Displays'
const ICON = 'display-brightness-symbolic'
const DARK = 'prefer-dark'
const LIGHT = 'default'

/**
 * A labelled brightness slider with a mark at the saved value.
 */
const SliderRow = GObject.registerClass(
class SliderRow extends PopupMenu.PopupBaseMenuItem {
    _init(name, onChanged) {
        super._init({ activate: false, style_class: 'ds-row' })

        this._unsavedDot = new St.Widget({ style_class: 'ds-dot', y_align: Clutter.ActorAlign.CENTER, visible: false })
        this.add_child(this._unsavedDot)

        this.add_child(new St.Label({
            text: name,
            style_class: 'ds-name',
            y_align: Clutter.ActorAlign.CENTER,
        }))

        const track = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true })
        this._slider = new Slider(0)
        this._slider.accessible_name = name
        this._slider.x_expand = true
        track.add_child(this._slider)

        this._mark = new St.Widget({
            style_class: 'ds-saved-mark',
            // Without expanding, BinLayout centres the mark and ignores START
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        })
        track.add_child(this._mark)
        // The track is allocated before the slider, so follow the slider itself
        this._slider.connect('notify::allocation', () => this._placeMark())
        this.add_child(track)

        this._valueLabel = new St.Label({ style_class: 'ds-value', y_align: Clutter.ActorAlign.CENTER })
        this.add_child(this._valueLabel)

        this._changedId = this._slider.connect('notify::value', () => {
            this._updateLabel()
            onChanged(this._slider.value)
        })
        this._savedFraction = null

        this._dragging = false
        this._slider.connect('drag-begin', () => { this._dragging = true })
        this._slider.connect('drag-end', () => { this._dragging = false })
    }

    get dragging() {
        return this._dragging
    }

    set value(fraction) {
        this._slider.block_signal_handler(this._changedId)
        this._slider.value = fraction
        this._slider.unblock_signal_handler(this._changedId)
        this._updateLabel()
    }

    /** Marks a display the saved setup does not hold. */
    setUnsaved(unsaved) {
        this._unsavedDot.visible = unsaved
    }

    /** Shows the mark at `fraction`, or hides it with null. */
    setSaved(fraction) {
        this._savedFraction = fraction
        this._mark.visible = fraction !== null
        this._placeMark()
    }

    _placeMark() {
        if (this._savedFraction === null)
            return

        if (!this._slider.has_allocation())
            return

        // The handle's centre travels between one radius from either end
        const width = this._slider.allocation.get_width()
        const radius = this._slider.get_theme_node().get_length('-slider-handle-radius')
        const markWidth = this._mark.get_theme_node().get_width()
        const centre = radius + this._savedFraction * (width - 2 * radius)
        this._mark.translation_x = Math.clamp(centre - markWidth / 2, 0, width - markWidth)
    }

    _updateLabel() {
        this._valueLabel.text = `${Math.round(this._slider.value * 100)}`
    }
})

export const DisplaySettingsToggle = GObject.registerClass(
class DisplaySettingsToggle extends QuickMenuToggle {
    _init(ddc, builtin, settings, onRestore) {
        super._init({ title: TITLE, iconName: ICON, toggleMode: false })

        this._ddc = ddc
        this._builtin = builtin
        this._settings = settings

        this._monitors = []      // [{edid, name, max}] answering DDC
        this._external = {}      // edid → raw brightness
        this._rows = new Map()   // edid or 'builtin' → SliderRow
        this._key = null
        this._profile = null
        this._diff = diffProfile(null, this._state())

        this.menu.setHeader(ICON, TITLE)

        this._slidersSection = new PopupMenu.PopupMenuSection()
        this.menu.addMenuItem(this._slidersSection)
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())

        this._darkItem = new PopupMenu.PopupSwitchMenuItem('Dark Style', false)
        this._darkDot = new St.Widget({ style_class: 'ds-dot', y_align: Clutter.ActorAlign.CENTER, visible: false })
        this._darkItem.insert_child_at_index(this._darkDot, 0)
        this._darkSaved = new St.Label({ style_class: 'ds-saved-label', y_align: Clutter.ActorAlign.CENTER, visible: false })
        this._darkItem.insert_child_above(this._darkSaved, this._darkItem.label)
        // No hover highlight; clicking the row still toggles
        this._darkItem.track_hover = false
        // Toggling would otherwise close the menu, as activating any item does
        this._darkItem.activate = () => this._darkItem.toggle()
        this._darkItem.connect('toggled', (_item, dark) => this._settings.set_string('color-scheme', dark ? DARK : LIGHT))
        this.menu.addMenuItem(this._darkItem)

        // A plain box rather than a menu item, so the row has no hover highlight
        const buttonsSection = new PopupMenu.PopupMenuSection()
        const buttons = new St.BoxLayout({ style_class: 'ds-buttons', x_expand: true })
        buttonsSection.actor.add_child(buttons)
        this._saveButton = new St.Button({ label: 'Save this setup', style_class: 'button ds-button', x_expand: true, can_focus: true })
        this._restoreButton = new St.Button({ label: 'Restore', style_class: 'button ds-button', x_expand: true, can_focus: true })
        this._saveButton.connect('clicked', () => this.save().catch(error => logError(error, '[display-settings] Save failed')))
        this._restoreButton.connect('clicked', () => onRestore())
        buttons.add_child(this._saveButton)
        buttons.add_child(this._restoreButton)
        this.menu.addMenuItem(buttonsSection)

        this.connect('clicked', () => this.menu.open())
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this.refresh().catch(error => logError(error, '[display-settings] Refresh failed'))
        })

        this._builtin.connectObject('changed', () => this._onBuiltinChanged(), this)
        this._settings.connectObject('changed::color-scheme', () => this._updateDiff(), this)

        this._rebuildRows()
        this._updateDiff()
    }

    get differences() {
        return this._diff.count
    }

    get hasProfile() {
        return this._profile !== null
    }

    /**
     * Reads every display and the saved profile for the current desk.
     */
    refresh() {
        // Each refresh starts after the previous one, so results never apply out of order
        this._refreshing = (this._refreshing ?? Promise.resolve())
            .catch(() => {})
            .then(() => this._refresh())

        return this._refreshing
    }

    async _refresh() {
        const detected = await this._ddc.detect()
        const readings = await Promise.all(detected.map(monitor => this._ddc.get(monitor.edid)))

        this._detected = detected
        this._monitors = []
        const previous = this._external
        this._external = {}
        detected.forEach((monitor, i) => {
            if (!readings[i])
                return

            this._monitors.push({ ...monitor, max: readings[i].max })
            // A slider dragged while reading keeps its own value
            this._external[monitor.edid] = this._rows.get(monitor.edid)?.dragging
                ? previous[monitor.edid]
                : readings[i].value
        })

        // Without ddcutil-service the desk is unknown, so nothing is saved or restored
        this._key = this._ddc.unavailable ? null : deskKey(detected.map(monitor => monitor.edid))
        this._profile = this._key ? await loadProfile(this._key) : null

        const layout = this._layout()
        if (layout !== this._shownLayout)
            this._rebuildRows()
        else
            this._updateRowValues()
        this._updateDiff()
    }

    async save() {
        if (!this._key)
            return

        await saveProfile(this._key, this._state())
        await this.refresh()
    }

    /**
     * Applies the saved desk setup. Resolves to the names of displays that
     * could not be set.
     */
    async restore() {
        const profile = this._profile
        if (!profile)
            return []

        const failures = []
        await this.refresh()
        const diff = this._diff
        console.log(`[display-settings] Restore: builtin ${diff.builtin} (${this._builtin.value} → ${profile.builtin}), style ${diff.style}, external ${[...diff.external].length}`)

        // Saved monitors that are connected but not answering cannot be restored
        for (const monitor of this._detected ?? []) {
            if (monitor.edid in profile.external && !(monitor.edid in this._external))
                failures.push(monitor.name)
        }

        if (diff.builtin)
            this._builtin.value = profile.builtin

        if (diff.style)
            this._settings.set_string('color-scheme', profile.style)

        await Promise.all(this._monitors
            .filter(monitor => diff.external.has(monitor.edid))
            .map(async monitor => {
                const target = profile.external[monitor.edid]
                this._ddc.set(monitor.edid, target, { force: true })
                await this._ddc.idle(monitor.edid)

                const reading = await this._ddc.get(monitor.edid)
                if (reading?.value !== target)
                    failures.push(monitor.name)
            }))

        await this.refresh()
        console.log(`[display-settings] Restore done: builtin now ${this._builtin.value}, ${this._diff.count} still differ, failures: ${failures.join(', ') || 'none'}`)

        return failures
    }

    _state() {
        return {
            style: this._settings.get_string('color-scheme') === DARK ? DARK : LIGHT,
            builtin: this._builtin.available ? this._builtin.value : null,
            external: { ...this._external },
        }
    }

    _layout() {
        return JSON.stringify([this._builtin.available, ...this._monitors.map(monitor => monitor.edid)])
    }

    _updateRowValues() {
        if (this._builtin.available)
            this._rows.get('builtin').value = this._builtin.value
        for (const monitor of this._monitors) {
            const row = this._rows.get(monitor.edid)
            if (!row.dragging)
                row.value = this._external[monitor.edid] / monitor.max
        }
    }

    _rebuildRows() {
        this._shownLayout = this._layout()
        // The menu remembers its active item; clear it before the rows go away
        for (const row of this._rows.values())
            row.active = false
        this._slidersSection.removeAll()
        this._rows.clear()

        if (this._builtin.available) {
            const row = new SliderRow('Built-in display', value => {
                this._builtin.value = value
            })
            this._rows.set('builtin', row)
            this._slidersSection.addMenuItem(row)
        }

        for (const monitor of this._monitors) {
            const row = new SliderRow(monitor.name, value => {
                const raw = Math.round(value * monitor.max)
                this._external[monitor.edid] = raw
                this._ddc.set(monitor.edid, raw)
                this._updateDiff()
            })
            this._rows.set(monitor.edid, row)
            this._slidersSection.addMenuItem(row)
        }

        this._updateRowValues()
    }

    _onBuiltinChanged() {
        if (this._builtin.available !== this._rows.has('builtin')) {
            this._rebuildRows()
        } else if (this._builtin.available) {
            this._rows.get('builtin').value = this._builtin.value
        }

        this._updateDiff()
    }

    _updateDiff() {
        const state = this._state()
        const profile = this._profile
        this._diff = diffProfile(profile, state)

        this._rows.get('builtin')?.setSaved(this._diff.builtin ? profile.builtin : null)
        this._rows.get('builtin')?.setUnsaved(profile !== null && this._diff.builtinUnsaved)
        for (const monitor of this._monitors)
            this._rows.get(monitor.edid).setUnsaved(this._diff.unsaved.has(monitor.edid))
        for (const monitor of this._monitors) {
            this._rows.get(monitor.edid).setSaved(this._diff.external.has(monitor.edid)
                ? profile.external[monitor.edid] / monitor.max
                : null)
        }

        this._darkItem.setToggleState(state.style === DARK)
        this._darkDot.visible = this._diff.style
        this._darkSaved.visible = this._diff.style
        this._darkSaved.text = profile?.style === DARK ? 'saved: on' : 'saved: off'

        const count = this._diff.count
        this._restoreButton.label = count > 0 ? `Restore (${count})` : 'Restore'
        this._restoreButton.reactive = count > 0
        this._restoreButton[count > 0 ? 'add_style_class_name' : 'remove_style_class_name']('ds-restore-active')
        this._saveButton.reactive = this._key !== null && this._diff.saveNeeded

        this.subtitle = count > 0 ? `${count} differ from saved` : null
    }

    destroy() {
        this._builtin.disconnectObject(this)
        this._settings.disconnectObject(this)
        super.destroy()
    }
})

export const DisplaySettingsIndicator = GObject.registerClass(
class DisplaySettingsIndicator extends SystemIndicator {
    _init(ddc, builtin, settings, onRestore) {
        super._init()

        this.toggle = new DisplaySettingsToggle(ddc, builtin, settings, onRestore)
        this.quickSettingsItems.push(this.toggle)
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy())
        this.quickSettingsItems = []
        super.destroy()
    }
})
