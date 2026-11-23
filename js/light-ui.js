// The "Light" controls. There are two profiles, day and night; the sliders edit
// whichever one is showing right now, so adjusting the light in bed tunes the
// night setup for every night after. Used in the reader's light sheet and in a
// dialog from the library.
import { settings } from './settings.js'
import { light, scheduleSummary, scheduleLocation } from './light.js'
import { icon } from './icons.js'
import { h, toast } from './util.js'

const time = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const seg = (options, current, onPick) => h('div', { class: 'segmented' },
    options.map(([value, label]) => h('button', {
        class: `seg${value === current ? ' active' : ''}`,
        'aria-pressed': String(value === current),
        onclick: () => onPick(value),
    }, label)))

const slider = ({ label, key, iconLow, iconHigh, cls }) => {
    const value = h('span', { class: 'light-value' }, String(settings[key]))
    const input = h('input', {
        type: 'range', min: '0', max: '24', step: '1', class: `light-slider ${cls ?? ''}`,
        'aria-label': label,
    })
    input.value = settings[key]
    input.addEventListener('input', () => {
        value.textContent = input.value
        settings.set({ [key]: +input.value })
    })
    const nudge = d => () => {
        input.value = Math.max(0, Math.min(24, +input.value + d))
        input.dispatchEvent(new Event('input'))
    }
    return h('div', { class: 'light-row' },
        h('div', { class: 'light-row-head' }, h('span', { class: 'setting-label' }, label), value),
        h('div', { class: 'light-slider-row' },
            h('button', { class: 'icon-btn small', 'aria-label': `Less ${label.toLowerCase()}`, html: icon(iconLow), onclick: nudge(-1) }),
            input,
            h('button', { class: 'icon-btn small', 'aria-label': `More ${label.toLowerCase()}`, html: icon(iconHigh), onclick: nudge(1) })))
}

// which profile the sliders edit; defaults to the one showing now
let editing = null

export const renderLightControls = rerender => {
    const showingNight = light.isNight
    const profile = editing ?? (showingNight ? 'night' : 'day')
    const night = profile === 'night'
    const keys = night ? { b: 'nightBrightness', w: 'nightWarmth' } : { b: 'brightness', w: 'warmth' }
    const previewing = (profile === 'night') !== showingNight
    light.setPreview(previewing ? profile : null)

    // when night starts and ends
    let when = null
    if (settings.nightMode === 'auto') {
        const sum = scheduleSummary()
        let text = ''
        if (sum?.always) text = 'The sun stays down here today, so it’s night all day.'
        else if (sum?.never) text = 'The sun stays up here today, so night mode stays off.'
        else if (sum) text = sum.active
            ? `Night until ${time(sum.end)}.`
            : `Night from ${time(sum.start)} to ${time(sum.end)}.`
        const loc = scheduleLocation()
        when = h('div', { class: 'setting-hint light-note' }, text, ' It fades in and out gradually.',
            settings.nightSchedule === 'sun' ? h('div', { class: 'light-loc' },
                loc.approximate ? 'Sunset is estimated from your time zone. ' : 'Using your location. ',
                h('button', { class: 'link-btn', onclick: async () => {
                    if (!loc.approximate) { settings.set({ location: null }); return rerender() }
                    try { await light.useMyLocation(); toast('Sunset times updated') }
                    catch { toast('Location not available. Keeping the estimate.') }
                    rerender()
                } }, loc.approximate ? 'Use my location' : 'Forget location')) : null)
    } else if (settings.nightMode === 'system') {
        when = h('p', { class: 'setting-hint light-note' },
            'Night whenever your phone is in dark mode. Set your phone’s appearance to Automatic to switch at sunset.')
    }

    const custom = settings.nightMode === 'auto' && settings.nightSchedule === 'custom' ? h('div', { class: 'light-times' },
        h('label', {}, 'From ', h('input', { type: 'time', class: 'text-input time-input', value: settings.nightFrom,
            onchange: e => { settings.set({ nightFrom: e.target.value || '21:00' }); rerender() } })),
        h('label', {}, 'to ', h('input', { type: 'time', class: 'text-input time-input', value: settings.nightTo,
            onchange: e => { settings.set({ nightTo: e.target.value || '07:00' }); rerender() } }))) : null

    return h('div', { class: 'light-controls' },
        h('div', { class: 'profile-tabs', role: 'tablist' },
            [['day', 'Day', 'sun'], ['night', 'Night', 'moon']].map(([id, label, ic]) => h('button', {
                class: `profile-tab${profile === id ? ' active' : ''}`, role: 'tab',
                'aria-selected': String(profile === id),
                onclick: () => { editing = id === (showingNight ? 'night' : 'day') ? null : id; rerender() },
            }, h('span', { html: icon(ic) }), label,
            (id === 'night') === showingNight ? h('span', { class: 'profile-now' }, 'now') : null))),
        previewing ? h('p', { class: 'setting-hint' },
            `Previewing the ${profile} settings. They take effect ${night ? 'at night' : 'during the day'}.`) : null,
        slider({ label: 'Brightness', key: keys.b, iconLow: 'sunSmall', iconHigh: 'sun' }),
        slider({ label: 'Warmth', key: keys.w, iconLow: 'sunSmall', iconHigh: 'warm', cls: 'warm' }),
        night ? h('div', { class: 'setting-row' },
            h('div', { class: 'setting-label' }, 'Night page'),
            seg([['dark', 'Dark'], ['same', 'Same as day']], settings.nightTheme,
                v => { settings.set({ nightTheme: v }); rerender() })) : null,
        h('div', { class: 'setting-row' },
            h('div', { class: 'setting-label' }, 'Night mode'),
            seg([['auto', 'Auto'], ['system', 'Match phone'], ['on', 'On'], ['off', 'Off']], settings.nightMode,
                v => { editing = null; settings.set({ nightMode: v }); rerender() })),
        settings.nightMode === 'auto' ? h('div', { class: 'setting-row' },
            h('div', { class: 'setting-label' }, 'Night is'),
            seg([['sun', 'Sunset to sunrise'], ['custom', 'Custom hours']], settings.nightSchedule,
                v => { settings.set({ nightSchedule: v }); rerender() })) : null,
        custom, when,
        h('p', { class: 'setting-hint' },
            'Brightness dims the page itself, so it can go darker than your screen’s lowest setting. Warmth takes out blue light, like a warm reading lamp.'))
}

// forget a "previewing the other profile" choice when the panel closes
export const resetLightEditing = () => {
    editing = null
    light.setPreview(null)
}
