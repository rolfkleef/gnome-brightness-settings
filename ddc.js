// External monitor brightness through ddcutil-service (DDC/CI, VCP 0x10).

import Gio from 'gi://Gio'

import { CoalescingWriter } from './writer.js'

const BRIGHTNESS = 0x10

const INTERFACE = `
<node>
  <interface name="com.ddcutil.DdcutilInterface">
    <method name="Detect">
      <arg name="flags" type="u" direction="in"/>
      <arg name="number_of_displays" type="i" direction="out"/>
      <arg name="detected_displays" type="a(iiisssqsu)" direction="out"/>
      <arg name="error_status" type="i" direction="out"/>
      <arg name="error_message" type="s" direction="out"/>
    </method>
    <method name="GetVcp">
      <arg name="display_number" type="i" direction="in"/>
      <arg name="edid_txt" type="s" direction="in"/>
      <arg name="vcp_code" type="y" direction="in"/>
      <arg name="flags" type="u" direction="in"/>
      <arg name="vcp_current_value" type="q" direction="out"/>
      <arg name="vcp_max_value" type="q" direction="out"/>
      <arg name="vcp_formatted_value" type="s" direction="out"/>
      <arg name="error_status" type="i" direction="out"/>
      <arg name="error_message" type="s" direction="out"/>
    </method>
    <method name="SetVcp">
      <arg name="display_number" type="i" direction="in"/>
      <arg name="edid_txt" type="s" direction="in"/>
      <arg name="vcp_code" type="y" direction="in"/>
      <arg name="vcp_new_value" type="q" direction="in"/>
      <arg name="flags" type="u" direction="in"/>
      <arg name="error_status" type="i" direction="out"/>
      <arg name="error_message" type="s" direction="out"/>
    </method>
  </interface>
</node>`

const DdcProxy = Gio.DBusProxy.makeProxyWrapper(INTERFACE)

/**
 * The name Settings shows for the monitor with this model and serial.
 */
function displayName(model, serial) {
    const monitors = global.backend.get_monitor_manager()
        .get_logical_monitors()
        .flatMap(logical => logical.get_monitors())
    const monitor = monitors.find(m => m.get_product() === model && m.get_serial() === serial)

    return monitor?.get_display_name() ?? model
}

export class Ddc {
    async init() {
        this._writers = new Map()
        this._cancellable = new Gio.Cancellable()
        this.unavailable = false

        this._proxy = await new Promise((resolve, reject) => {
            DdcProxy(Gio.DBus.session, 'com.ddcutil.DdcutilService', '/com/ddcutil/DdcutilObject',
                (proxy, error) => error ? reject(error) : resolve(proxy),
                this._cancellable, Gio.DBusProxyFlags.DO_NOT_AUTO_START_AT_CONSTRUCTION)
        })
    }

    /** Resolves to `[{edid, name}]`, or `[]` when ddcutil-service is missing. */
    async detect() {
        let reply

        try {
            reply = await this._proxy.DetectAsync(0, this._cancellable)
        } catch (error) {
            if (error.message.includes('ServiceUnknown')) {
                this.unavailable = true
                return []
            }
            throw error
        }

        this.unavailable = false

        const [, displays, status, message] = reply
        if (status !== 0)
            throw new Error(`Detect: ${message} (${status})`)

        return displays.map(row => ({ edid: row[7], name: displayName(row[4], row[5]) }))
    }

    /** Resolves to `{value, max}`, or null when the monitor does not answer. */
    async get(edid) {
        try {
            const [value, max, , status] = await this._proxy.GetVcpAsync(
                -1, edid, BRIGHTNESS, 0, this._cancellable)

            return status === 0 && max > 0 ? { value, max } : null
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw error
            return null
        }
    }

    set(edid, value) {
        this._writer(edid).set(value)
    }

    /** Resolves once the writes queued for this monitor have finished. */
    idle(edid) {
        return this._writer(edid).idle()
    }

    _writer(edid) {
        if (!this._writers.has(edid)) {
            this._writers.set(edid, new CoalescingWriter(async value => {
                const [status, message] = await this._proxy.SetVcpAsync(
                    -1, edid, BRIGHTNESS, value, 0, this._cancellable)

                if (status !== 0)
                    throw new Error(`SetVcp: ${message} (${status})`)
            }))
        }

        return this._writers.get(edid)
    }

    destroy() {
        this._cancellable?.cancel()
        this._writers?.clear()
        this._proxy = null
    }
}
