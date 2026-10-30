import GLib from 'gi://GLib'

const tmp = GLib.dir_make_tmp('display-settings-XXXXXX')
GLib.setenv('XDG_CONFIG_HOME', tmp, true)

const { deskKey, diffProfile, loadProfile, saveProfile } = await import('../../extension/profile.js')

function assert(condition, message) {
    if (!condition)
        throw new Error(`FAIL: ${message}`)
}

const base = { style: 'default', builtin: 0.5, external: { e1: 100 } }
const state = changes => ({ ...base, ...changes, external: { ...base.external, ...changes.external } })

assert(deskKey(['b', 'a']) === deskKey(['a', 'b']), 'key ignores order')
assert(deskKey(['a']).length === 20, 'key length 20')
assert(deskKey([]) === deskKey([]), 'empty key stable')
assert(deskKey(['a']) !== deskKey(['b']), 'keys differ per desk')

assert(diffProfile(null, base).count === 0, 'no profile, no differences')
assert(diffProfile(base, state({})).count === 0, 'equal state')
assert(!diffProfile(base, state({ builtin: 0.505 })).builtin, 'builtin within threshold')
assert(diffProfile(base, state({ builtin: 0.52 })).builtin, 'builtin beyond threshold')

const ext = diffProfile(base, state({ external: { e1: 99 } }))
assert(ext.external.has('e1') && ext.count === 1, 'external differs')

assert(diffProfile(base, state({ style: 'prefer-dark' })).style, 'style differs')
assert(diffProfile(base, state({ style: 'prefer-dark', builtin: 0.9, external: { e1: 1 } })).count === 3, 'three differ')
assert(diffProfile(base, state({ external: { e2: 5 } })).count === 0, 'unsaved monitor ignored')
assert(diffProfile({ ...base, builtin: null }, state({ builtin: 0.9 })).count === 0, 'unsaved builtin ignored')

// Displays the profile does not hold are unsaved: not restorable, but worth saving
const unsaved = diffProfile(base, state({ external: { e2: 5 } }))
assert(unsaved.unsaved.has('e2') && !unsaved.unsaved.has('e1'), 'e2 unsaved')
assert(unsaved.saveNeeded, 'unsaved display needs saving')
const noBuiltin = diffProfile({ ...base, builtin: null }, state({ builtin: 0.9 }))
assert(noBuiltin.builtinUnsaved && noBuiltin.saveNeeded, 'unsaved builtin needs saving')
assert(!diffProfile(base, state({})).saveNeeded, 'equal state needs no saving')
assert(diffProfile(null, base).saveNeeded, 'no profile needs saving')
assert(diffProfile(base, state({ builtin: 0.9 })).saveNeeded, 'a difference needs saving')

// Night light: compared like style; profiles saved before it existed don't hold it
const withNight = { ...base, nightLight: false }
const night = changes => ({ ...state(changes), nightLight: changes.nightLight ?? false })
assert(!diffProfile(withNight, night({})).nightLight, 'night light equal')
const nightDiff = diffProfile(withNight, night({ nightLight: true }))
assert(nightDiff.nightLight && nightDiff.count === 1, 'night light differs')
const oldProfile = diffProfile(base, night({ nightLight: true }))
assert(!oldProfile.nightLight && oldProfile.count === 0 && oldProfile.saveNeeded, 'old profile: not compared, save offered')

assert(await loadProfile('missing') === null, 'missing profile is null')
await saveProfile('k1', base)
const loaded = await loadProfile('k1')
assert(JSON.stringify(loaded) === JSON.stringify(base), 'round trip')
assert(GLib.file_test(`${tmp}/display-settings/desk-k1.json`, GLib.FileTest.EXISTS), 'stored under config dir')

print('ok profile')
