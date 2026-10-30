// Display Settings: brightness for the built-in and external displays, dark
// style, and per-desk save and restore, in one Quick Settings tile.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js'

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

import { Builtin } from './builtin.js'
import { Ddc } from './ddc.js'
import { DisplaySettingsIndicator } from './menu.js'

// ddcutil needs a moment after a hotplug before monitors answer
const SETTLE_SECONDS = 5

// GNOME's own controls, replaced by the tile while it is enabled
const REPLACED_INDICATORS = ['_brightness', '_darkMode']

export default class DisplaySettingsExtension extends Extension {
    enable() {
        this._settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' })
        this._ddc = new Ddc()
        this._builtin = new Builtin()
        this._indicator = new DisplaySettingsIndicator(this._ddc, this._builtin, this._settings,
            () => this._restore())
        this._toggle = this._indicator.toggle
        this._hidden = []

        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator)
        this._hideGnomeItems()

        global.backend.get_monitor_manager().connectObject(
            'monitors-changed', () => this._scheduleCheck(), this)

        const ddc = this._ddc
        ddc.init()
            .then(() => {
                if (this._ddc === ddc)
                    this._scheduleCheck()
            })
            .catch(error => logError(error, '[display-settings] ddcutil-service unavailable'))
    }

    /**
     * Quick Settings creates its indicators asynchronously, so right after
     * login they may not exist yet.
     */
    _hideGnomeItems(attempt = 0) {
        const quickSettings = Main.panel.statusArea.quickSettings
        const missing = REPLACED_INDICATORS.filter(name => !quickSettings[name])

        if (missing.length > 0 && attempt < 20) {
            this._hideRetryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._hideRetryId = 0
                this._hideGnomeItems(attempt + 1)
                return GLib.SOURCE_REMOVE
            })
            return
        }

        for (const name of REPLACED_INDICATORS) {
            for (const item of quickSettings[name]?.quickSettingsItems ?? []) {
                item.hide()
                // GNOME's brightness item shows itself again when backlights change
                item.connectObject('notify::visible', () => item.visible && item.hide(), this)
                this._hidden.push(item)
            }
        }
    }

    _showGnomeItems() {
        for (const item of this._hidden) {
            item.disconnectObject(this)
            item.show()
            item._sync?.()
        }
        this._hidden = []
    }

    _scheduleCheck() {
        if (this._checkId)
            GLib.source_remove(this._checkId)

        this._checkId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SETTLE_SECONDS, () => {
            this._checkId = 0
            this._check().catch(error => logError(error, '[display-settings] Desk check failed'))
            return GLib.SOURCE_REMOVE
        })
    }

    async _check() {
        const toggle = this._toggle
        await toggle.refresh()

        if (this._toggle !== toggle)
            return

        this._notification?.destroy()

        if (!toggle.hasProfile || toggle.differences === 0)
            return

        this._notification = this._notify('Restore display settings?',
            `${toggle.differences} differ from the saved desk setup.`)
        this._notification.addAction('Restore', () => this._restore())
    }

    async _restore() {
        let failures

        try {
            failures = await this._toggle.restore()
        } catch (error) {
            logError(error, '[display-settings] Restore failed')
            failures = ['all displays']
        }

        if (failures.length > 0)
            this._notify('Some displays were not restored', failures.join(', '))
    }

    _notify(title, body) {
        if (!this._source) {
            this._source = new MessageTray.Source({ title: 'Display settings', iconName: 'display-brightness-symbolic' })
            this._source.connect('destroy', () => {
                this._source = null
            })
            Main.messageTray.add(this._source)
        }

        const notification = new MessageTray.Notification({ source: this._source, title, body })
        notification.connect('destroy', () => {
            if (this._notification === notification)
                this._notification = null
        })
        this._source.addNotification(notification)

        return notification
    }

    disable() {
        for (const id of [this._checkId, this._hideRetryId]) {
            if (id)
                GLib.source_remove(id)
        }
        this._checkId = this._hideRetryId = 0

        global.backend.get_monitor_manager().disconnectObject(this)
        this._showGnomeItems()

        this._source?.destroy()
        this._source = null
        this._notification = null

        this._indicator.destroy()
        this._indicator = this._toggle = null

        this._builtin.destroy()
        this._builtin = null
        this._ddc.destroy()
        this._ddc = null
        this._settings = null
    }
}
