// The "Light" controls: brightness, warmth, warm-light schedule, dark at night.
// Used in the reader's light sheet and in a dialog from the library.
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
    return h('div', { class: 'light-row' },
        h('div', { class: 'light-row-head' }, h('span', { class: 'setting-label' }, label), value),
        h('div', { class: 'light-slider-row' },
            h('button', { class: 'icon-btn small', 'aria-label': `Less ${label.toLowerCase()}`, html: icon(iconLow),
                onclick: () => { input.value = Math.max(0, +input.value - 1); input.dispatchEvent(new Event('input')) } }),
            input,
            h('button', { class: 'icon-btn small', 'aria-label': `More ${label.toLowerCase()}`, html: icon(iconHigh),
                onclick: () => { input.value = Math.min(24, +input.value + 1); input.dispatchEvent(new Event('input')) } })))
}

export const renderLightControls = rerender => {
    const sum = scheduleSummary()
    let scheduleNote = null
    if (settings.warmSchedule !== 'off') {
        let text
        if (sum?.always) text = 'The sun stays down here today: warm light is on all day.'
        else if (sum?.never) text = 'The sun stays up here today: warm light stays off.'
        else if (sum) text = sum.active
            ? `On now, until ${time(sum.end)}.`
            : `Turns on at ${time(sum.start)}, off at ${time(sum.end)}.`
        const loc = scheduleLocation()
        scheduleNote = h('div', { class: 'setting-hint light-note' },
            text, ' It fades in and out gradually.',
            settings.warmSchedule === 'sun' ? h('div', { class: 'light-loc' },
                loc.approximate
                    ? h('span', {}, 'Sunset times are estimated from your time zone. ')
                    : h('span', {}, 'Using your location. '),
                h('button', { class: 'link-btn', onclick: async () => {
                    if (!loc.approximate) { settings.set({ location: null }); return rerender() }
                    try { await light.useMyLocation(); toast('Sunset times updated') }
                    catch { toast('Location not available. Keeping the estimate.') }
                    rerender()
                } }, loc.approximate ? 'Use my location' : 'Forget location')) : null)
    }
    const custom = settings.warmSchedule === 'custom' ? h('div', { class: 'light-times' },
        h('label', {}, 'From ', h('input', { type: 'time', class: 'text-input time-input', value: settings.warmFrom,
            onchange: e => { settings.set({ warmFrom: e.target.value || '21:00' }); rerender() } })),
        h('label', {}, 'to ', h('input', { type: 'time', class: 'text-input time-input', value: settings.warmTo,
            onchange: e => { settings.set({ warmTo: e.target.value || '07:00' }); rerender() } }))) : null

    const warmthOffNow = settings.warmSchedule !== 'off' && settings.warmth > 0 && light.state.warmth === 0
    return h('div', { class: 'light-controls' },
        slider({ label: 'Brightness', key: 'brightness', iconLow: 'sunSmall', iconHigh: 'sun' }),
        h('p', { class: 'setting-hint' }, 'Dims the page itself, so it can go darker than your screen’s lowest setting. Keep the device brightness where it’s comfortable and fine-tune here.'),
        slider({ label: 'Warmth', key: 'warmth', iconLow: 'sunSmall', iconHigh: 'warm', cls: 'warm' }),
        warmthOffNow ? h('p', { class: 'setting-hint' }, 'The schedule has warm light off right now; this level is used when it turns on.') : null,
        h('div', { class: 'setting-row' },
            h('div', { class: 'setting-label' }, 'Warm light schedule'),
            seg([['off', 'Off'], ['sun', 'Sunset to sunrise'], ['custom', 'Custom']], settings.warmSchedule,
                v => { settings.set({ warmSchedule: v, ...(v !== 'off' && !settings.warmth ? { warmth: 14 } : {}) }); rerender() })),
        custom, scheduleNote,
        h('div', { class: 'setting-row' },
            h('div', { class: 'setting-label' }, 'Dark mode at night'),
            seg([['off', 'Off'], ['schedule', 'With schedule'], ['system', 'Match system']], settings.nightDark,
                v => { settings.set({ nightDark: v }); rerender() })),
        settings.nightDark === 'schedule' && settings.warmSchedule === 'off'
            ? h('p', { class: 'setting-hint' }, 'Turn on a warm light schedule to set when “night” is.') : null)
}
