// The built-in screen's brightness, through the shell's own brightness
// manager, so GNOME's state, its OSD and every slider bound to it agree.

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js'

const CONNECTOR = 'eDP-1'

export class Builtin extends Signals.EventEmitter {
    constructor() {
        super()

        Main.brightnessManager.connectObject('changed', () => this._resolve(), this)
        this._resolve()
    }

    get available() {
        return this._scale !== null
    }

    /** Relative brightness, 0–1 of the backlight's range. */
    get value() {
        return this._scale?.value ?? null
    }

    set value(value) {
        if (this._scale)
            this._scale.value = value
    }

    _resolve() {
        this._scale?.disconnectObject(this)

        this._scale = Main.brightnessManager.scales.find(scale => scale.monitor
            .get_monitors()
            .some(monitor => monitor.get_connector() === CONNECTOR)) ?? null

        this._scale?.connectObject('notify::value', () => this.emit('changed'), this)
        this.emit('changed')
    }

    destroy() {
        this._scale?.disconnectObject(this)
        this._scale = null
        Main.brightnessManager.disconnectObject(this)
    }
}
