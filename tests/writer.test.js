import { CoalescingWriter } from '../writer.js'

function assert(condition, message) {
    if (!condition)
        throw new Error(`FAIL: ${message}`)
}

const calls = []
const pending = []
const writer = new CoalescingWriter(value => {
    calls.push(value)
    return new Promise(resolve => pending.push(resolve))
})

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

writer.set(1)
writer.set(2)
writer.set(3)
await tick()
assert(JSON.stringify(calls) === '[1]', `first write only, got ${calls}`)

pending.shift()()
await tick()
assert(JSON.stringify(calls) === '[1,3]', `latest value wins, got ${calls}`)

const idle = writer.idle()
let idled = false
idle.then(() => { idled = true })
await tick()
assert(!idled, 'not idle while writing')
pending.shift()()
await idle
assert(idled, 'idle after last write')

writer.set(3)
await tick()
assert(calls.length === 2, 'same value as last written is skipped')

await writer.idle()

// A failed write does not block later ones
const failing = new CoalescingWriter(value => value === 1 ? Promise.reject(new Error('ddc')) : Promise.resolve())
failing.set(1)
await failing.idle()
failing.set(2)
await failing.idle()

// Restore writes even a value equal to the last one written, since the
// monitor may have been changed with its own buttons since
const forced = []
const restoring = new CoalescingWriter(value => { forced.push(value); return Promise.resolve() })
restoring.set(50)
await restoring.idle()
restoring.set(50, { force: true })
await restoring.idle()
assert(JSON.stringify(forced) === '[50,50]', `forced write repeats, got ${forced}`)

print('ok writer')
