// The keyboard backlight, through gnome-settings-daemon as GNOME's own
// keyboard brightness control does. Brightness is 0–100 in `steps` levels.

import Gio from 'gi://Gio'

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js'

const INTERFACE = `
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Keyboard">
    <property name="Brightness" type="i" access="readwrite"/>
    <property name="Steps" type="i" access="read"/>
  </interface>
</node>`

const KeyboardProxy = Gio.DBusProxy.makeProxyWrapper(INTERFACE)

export class Keyboard extends Signals.EventEmitter {
    constructor() {
        super()

        this._proxy = null
        this._cancellable = new Gio.Cancellable()

        KeyboardProxy(Gio.DBus.session, 'org.gnome.SettingsDaemon.Power', '/org/gnome/SettingsDaemon/Power',
            (proxy, error) => {
                if (error) {
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(error, '[display-settings] No keyboard backlight service')
                    return
                }

                this._proxy = proxy
                proxy.connectObject('g-properties-changed', () => this.emit('changed'), this)
                this.emit('changed')
            }, this._cancellable)
    }

    /** Whether the laptop has a keyboard backlight; gsd-power reports -1 when not. */
    get available() {
        const brightness = this._proxy?.Brightness
        return Number.isInteger(brightness) && brightness >= 0
    }

    /** 0–100, or null when unavailable. */
    get value() {
        return this.available ? this._proxy.Brightness : null
    }

    set value(value) {
        if (this.available)
            this._proxy.Brightness = value
    }

    /** The nearest level to `fraction` (0–1), as 0–100. */
    snap(fraction) {
        const levels = Math.max(1, (this._proxy?.Steps ?? 2) - 1)
        return Math.round(Math.round(fraction * levels) * 100 / levels)
    }

    destroy() {
        this._cancellable.cancel()
        this._proxy?.disconnectObject(this)
        this._proxy = null
    }
}
