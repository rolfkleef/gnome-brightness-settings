// DDC/CI writes are slow. One write is kept in flight; values set meanwhile
// replace the pending one, so a slider drag ends on its last position.

export class CoalescingWriter {
    constructor(writeFn) {
        this._writeFn = writeFn
        this._pending = null
        this._lastWritten = null
        this._draining = null
    }

    /** With `force`, writes even a value equal to the last one written. */
    set(value, { force = false } = {}) {
        if (!force && value === this._lastWritten && this._pending === null)
            return

        this._pending = value
        this._draining ??= this._drain()
    }

    /** Resolves once every value set so far has been written. */
    idle() {
        return this._draining ?? Promise.resolve()
    }

    async _drain() {
        while (this._pending !== null) {
            const value = this._pending
            this._pending = null
            this._lastWritten = value

            try {
                await this._writeFn(value)
            } catch (error) {
                this._lastWritten = null
                logError(error, '[display-settings] Write failed')
            }
        }

        this._draining = null
    }
}
