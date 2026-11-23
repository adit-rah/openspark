// Front-light emulation.
//
// A dedicated e-reader lights its page from the front: the light's color and
// strength tint everything on the screen. We model that as a multiply: every
// color the app draws is multiplied by the light's RGB, so "warmth" pulls blue
// and green out of the page and "brightness" scales it down below the
// device's own minimum, without losing contrast between ink and paper.
//
// Web pages can't read the ambient light sensor or change the real screen
// brightness, so everything here works in pixels. A schedule (sunset to
// sunrise, computed on the device, or custom times) fades the warm light in and
// out gradually, and dark mode can follow the same schedule or the system.

import { settings } from './settings.js'

const RAMP_MIN = 40               // minutes to fade warm light in/out around the switch time
const COOLEST_K = 6500            // warmth 0: neutral daylight
const WARMEST_K = 2300            // warmth 24: deep amber
const MIN_LEVEL = 0.2             // brightness 0 keeps 20% of the light
const STEPS = 24                  // sliders go 0–24, like a dedicated reader

// ---------------------------------------------------------------- color math
const clamp01 = x => Math.max(0, Math.min(1, x))

// Black-body color for a temperature (Tanner Helland's fit), 0–255 per channel
const kelvinRGB = k => {
    const t = k / 100
    const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
    return [r, g, b].map(x => Math.max(0, Math.min(255, x)))
}
const NEUTRAL = kelvinRGB(COOLEST_K)

// warmth 0–24 → per-channel multiplier, interpolated in mireds so steps feel even
export const warmthRGB = warmth => {
    const f = clamp01(warmth / STEPS)
    const mired = 1e6 / COOLEST_K + (1e6 / WARMEST_K - 1e6 / COOLEST_K) * f
    const rgb = kelvinRGB(1e6 / mired)
    return rgb.map((c, i) => clamp01(c / NEUTRAL[i]))
}

// brightness 0–24 → overall multiplier (perceptual curve)
export const brightnessLevel = b => MIN_LEVEL + (1 - MIN_LEVEL) * clamp01(b / STEPS) ** 1.6

const parseHex = hex => {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim())
    return m ? m.slice(1).map(x => parseInt(x, 16)) : null
}
const toHex = rgb => '#' + rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join('')

// ---------------------------------------------------------------- sun times
// Sunrise/sunset for a date and place (the standard NOAA/suncalc approximation).
// Returns { rise, set } as Dates, or { polar: 'day' | 'night' }.
export const sunTimes = (date, lat, lon) => {
    const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009
    const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000
    const lw = rad * -lon, phi = rad * lat
    const n = Math.round(d - J0 - lw / (2 * Math.PI))
    const ds = J0 + lw / (2 * Math.PI) + n
    const M = rad * (357.5291 + 0.98560028 * ds)
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
    const L = M + C + rad * 102.9372 + Math.PI
    const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397))
    const jNoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
    const cosW = (Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))
    if (cosW > 1) return { polar: 'night' }
    if (cosW < -1) return { polar: 'day' }
    const w = Math.acos(cosW)
    const jSet = J2000 + J0 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
    const jRise = jNoon - (jSet - jNoon)
    const fromJ = j => new Date((j + 0.5 - J1970) * dayMs)
    return { rise: fromJ(jRise), set: fromJ(jSet) }
}

// Without permission to use location, guess one from the time zone:
// 15° of longitude per hour of offset, mid-latitude. Usually within an hour.
const guessedLocation = () => {
    const jan = new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset()
    const jul = new Date(new Date().getFullYear(), 6, 1).getTimezoneOffset()
    const standard = Math.max(jan, jul) // offset without daylight saving
    const southern = jan < jul
    return { lat: southern ? -35 : 42, lon: -standard / 4, approximate: true }
}
export const scheduleLocation = () => settings.location ?? guessedLocation()

const atTime = (day, hhmm) => {
    const [h, m] = String(hhmm || '00:00').split(':').map(Number)
    const d = new Date(day)
    d.setHours(h || 0, m || 0, 0, 0)
    return d
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

// The night window that starts on `day`: { start, end } or 'always' / 'never'
const nightWindow = day => {
    if (settings.warmSchedule === 'custom') {
        const start = atTime(day, settings.warmFrom)
        let end = atTime(day, settings.warmTo)
        if (end <= start) end = addDays(end, 1)
        return { start, end }
    }
    const { lat, lon } = scheduleLocation()
    const noon = atTime(day, '12:00')
    const today = sunTimes(noon, lat, lon)
    const tomorrow = sunTimes(addDays(noon, 1), lat, lon)
    if (today.polar === 'night') return 'always'
    if (today.polar === 'day') return 'never'
    return { start: today.set, end: tomorrow.rise ?? addDays(today.rise, 1) }
}

// 0 = day, 1 = night, fading over RAMP_MIN around each switch
export const nightFactor = (now = new Date()) => {
    const ramp = x => clamp01(x / (RAMP_MIN * 60e3) + 0.5)
    let n = 0
    for (const offset of [-1, 0]) {
        const w = nightWindow(addDays(now, offset))
        if (w === 'always') return 1
        if (w === 'never') continue
        n = Math.max(n, ramp(now - w.start) * (1 - ramp(now - w.end)))
    }
    return n
}

// Next switch times, for the panel
export const scheduleSummary = (now = new Date()) => {
    if (settings.warmSchedule === 'off') return null
    let w = nightWindow(addDays(now, -1))
    if (w === 'always') return { always: true }
    if (w === 'never' || now >= w.end) w = nightWindow(now)
    if (w === 'always') return { always: true }
    if (w === 'never') return { never: true }
    return { start: w.start, end: w.end, active: now >= w.start && now < w.end }
}

// ---------------------------------------------------------------- state
const systemDark = matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set()
let current = { rgb: [1, 1, 1], warmth: 0, level: 1, dark: false }

const compute = () => {
    const night = settings.warmSchedule === 'off' ? 1 : nightFactor()
    // quantize so the gradual fade doesn't restyle on every tiny change
    const warmth = Math.round(settings.warmth * night * 4) / 4
    const level = brightnessLevel(settings.brightness)
    const tint = warmthRGB(warmth)
    const dark = settings.nightDark === 'system' ? systemDark.matches
        : settings.nightDark === 'schedule' ? settings.warmSchedule !== 'off' && night >= 0.5
        : false
    return { rgb: tint.map(c => c * level), warmth, level, dark, night }
}

const same = (a, b) => a.dark === b.dark && a.rgb.every((x, i) => Math.abs(x - b.rgb[i]) < 0.002)

export const light = {
    get state() { return current },
    get active() { return current.rgb.some(x => x < 0.998) },
    // multiply a #rrggbb color by the current light
    lit(hex) {
        const rgb = parseHex(hex)
        if (!rgb || !this.active) return hex
        return toHex(rgb.map((c, i) => c * current.rgb[i]))
    },
    // the 4×5 color matrix for SVG feColorMatrix (images inside books)
    matrix() {
        const [r, g, b] = current.rgb
        return `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`
    },
    cssColor() {
        return `rgb(${current.rgb.map(x => Math.round(x * 255)).join(' ')})`
    },
    onChange(f) {
        listeners.add(f)
        return () => listeners.delete(f)
    },
    refresh(force = false) {
        const next = compute()
        const changed = force || !same(next, current)
        current = next
        settings.themeOverride = next.dark ? 'dark' : null
        settings.lightActive = this.active
        if (changed) for (const f of listeners) f(current)
    },
    async useMyLocation() {
        const pos = await new Promise((resolve, reject) =>
            navigator.geolocation
                ? navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 864e5, timeout: 15000 })
                : reject(new Error('Location is not available')))
        // a city-level position is plenty for sunset times; don't keep more
        const round = x => Math.round(x * 10) / 10
        settings.set({ location: { lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) } })
    },
}

settings.lit = hex => light.lit(hex)

const LIGHT_KEYS = ['brightness', 'warmth', 'warmSchedule', 'warmFrom', 'warmTo', 'location', 'nightDark']
settings.onChange(patch => {
    if (Object.keys(patch).some(k => LIGHT_KEYS.includes(k))) light.refresh()
})
systemDark.addEventListener('change', () => light.refresh())
// follow the schedule; also catch up when the app comes back from the background
setInterval(() => light.refresh(), 60e3)
document.addEventListener('visibilitychange', () => { if (!document.hidden) light.refresh() })
light.refresh(true)
