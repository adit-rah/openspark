import { storage } from './util.js'

const fontURL = name => new URL(`../fonts/${name}`, import.meta.url).href

// @font-face rules, injected both into the app and into every book page.
export const fontFaceCSS = () => `
@font-face { font-family: 'OS Literata'; font-style: normal; font-weight: 200 900; font-display: block;
  src: url(${fontURL('literata-normal.woff2')}) format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: 'OS Literata'; font-style: italic; font-weight: 200 900; font-display: block;
  src: url(${fontURL('literata-italic.woff2')}) format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: 'OS Literata'; font-style: normal; font-weight: 200 900; font-display: block;
  src: url(${fontURL('literata-ext-normal.woff2')}) format('woff2');
  unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family: 'OS Literata'; font-style: italic; font-weight: 200 900; font-display: block;
  src: url(${fontURL('literata-ext-italic.woff2')}) format('woff2');
  unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family: 'OS Atkinson'; font-style: normal; font-weight: 400; font-display: block; src: url(${fontURL('atkinson-400-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'OS Atkinson'; font-style: italic; font-weight: 400; font-display: block; src: url(${fontURL('atkinson-400-italic.woff2')}) format('woff2'); }
@font-face { font-family: 'OS Atkinson'; font-style: normal; font-weight: 700; font-display: block; src: url(${fontURL('atkinson-700-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'OS Atkinson'; font-style: italic; font-weight: 700; font-display: block; src: url(${fontURL('atkinson-700-italic.woff2')}) format('woff2'); }
`

export const FONTS = [
    { id: 'literata', label: 'Literata', stack: "'OS Literata', Georgia, serif" },
    { id: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
    { id: 'palatino', label: 'Palatino', stack: "Palatino, 'Palatino Linotype', 'Book Antiqua', 'URW Palladio L', serif" },
    { id: 'baskerville', label: 'Baskerville', stack: "Baskerville, 'Baskerville Old Face', 'Libre Baskerville', serif" },
    { id: 'sans', label: 'Sans serif', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
    { id: 'atkinson', label: 'Atkinson Hyperlegible', stack: "'OS Atkinson', Verdana, sans-serif" },
    { id: 'publisher', label: 'Publisher font', stack: null },
]

// px font sizes, 1-indexed steps like a dedicated e-reader
export const FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 27, 30, 34, 38]

export const LINE_SPACING = { compact: 1.3, normal: 1.5, loose: 1.8 }
export const MARGINS = { narrow: '3%', normal: '6%', wide: '11%' }

// Screen themes. "paper" is the default e-ink look.
export const THEMES = [
    { id: 'white', label: 'White', bg: '#ffffff', fg: '#111111', ui: '#ffffff', link: '#111111' },
    { id: 'paper', label: 'Paper', bg: '#f4f1ea', fg: '#1b1b1b', ui: '#f4f1ea', link: '#1b1b1b' },
    { id: 'sepia', label: 'Sepia', bg: '#f3e7cf', fg: '#4a3a28', ui: '#f3e7cf', link: '#4a3a28' },
    { id: 'green', label: 'Mint', bg: '#d7ead5', fg: '#14261a', ui: '#d7ead5', link: '#14261a' },
    { id: 'dark', label: 'Dark', bg: '#000000', fg: '#d2d2d2', ui: '#000000', link: '#d2d2d2' },
]

export const FOOTER_MODES = [
    ['chapter-time', 'Time left in chapter'],
    ['book-time', 'Time left in book'],
    ['location', 'Location in book'],
    ['page', 'Page in book (when available)'],
    ['none', 'None'],
]

const DEFAULTS = {
    font: 'literata',
    fontSize: 6,            // index into FONT_SIZES (17px)
    boldness: 0,            // 0-3
    lineSpacing: 'normal',
    margins: 'normal',
    justify: true,
    hyphenate: true,
    columns: 'auto',        // 'auto' (two columns on wide screens) | 'one'
    theme: 'paper',
    frame: 'auto',          // 'auto' | 'on' | 'off'  device bezel around the page
    grayscale: false,       // grayscale images, like an e-ink screen
    publisherColors: false,
    footer: 'chapter-time',
    showPercent: true,
    flash: 'off',           // 'off' | 'page' | 'chapter'   e-ink style refresh flash
    animate: false,         // sliding page turns (e-ink readers don't animate)
    // front light (see light.js). Day and night profiles; night is the bedtime setup.
    brightness: 24,         // day, 0–24; below 24 dims the page itself, under the device minimum
    warmth: 0,              // day, 0–24; 0 = neutral, 24 = deep amber
    nightBrightness: 14,
    nightWarmth: 16,
    nightTheme: 'dark',     // 'dark' | 'same' (keep the day theme, just dimmer and warmer)
    nightMode: 'auto',      // 'auto' (schedule) | 'system' (follow iOS/OS dark mode) | 'on' | 'off'
    nightSchedule: 'sun',   // 'sun' (sunset → sunrise) | 'custom'
    nightFrom: '21:00',
    nightTo: '07:00',
    location: null,         // { lat, lon } rounded, only if the user shares it
    resumeOnLaunch: true,   // open straight into the last book, like waking a reader
    // library
    libView: 'grid',
    libSort: 'recent',
    libFilter: 'all',
}

const KEY = 'openspark:settings'
const listeners = new Set()

export const settings = {
    ...DEFAULTS,
    ...storage.get(KEY, {}),
    set(patch) {
        Object.assign(this, patch)
        const out = {}
        for (const k of Object.keys(DEFAULTS)) out[k] = this[k]
        storage.set(KEY, out)
        for (const f of listeners) f(patch)
    },
    onChange(f) {
        listeners.add(f)
        return () => listeners.delete(f)
    },
    // set by light.js: a forced theme (dark at night) and the front-light color filter
    themeOverride: null,
    lit: x => x,
    lightActive: false,
    // the theme as it should be drawn right now, with the front light applied
    getTheme() {
        const t = THEMES.find(t => t.id === (this.themeOverride ?? this.theme)) ?? THEMES[1]
        return { ...t, base: t, bg: this.lit(t.bg), fg: this.lit(t.fg), link: this.lit(t.link) }
    },
}

// Images: optional grayscale, dimmed in dark mode, and tinted by the front light
// through an SVG color matrix that the reader injects into each page (#os-light).
const imageFilter = (s, theme) => {
    const f = []
    if (s.grayscale) f.push('grayscale(1)', 'contrast(1.05)')
    if (theme.id === 'dark') f.push('brightness(.85)')
    if (s.lightActive) f.push('url(#os-light)')
    return f.length ? `img, svg:not(#os-light-svg), video, canvas { filter: ${f.join(' ')}; }` : ''
}

// CSS injected into every page of the book.
export const bookCSS = s => {
    const theme = s.getTheme()
    const font = FONTS.find(f => f.id === s.font) ?? FONTS[0]
    const size = FONT_SIZES[s.fontSize] ?? 17
    const lh = LINE_SPACING[s.lineSpacing] ?? 1.5
    const stroke = [0, 0.012, 0.024, 0.036][s.boldness] ?? 0
    const forceColors = !s.publisherColors
    return `
${fontFaceCSS()}
@namespace epub "http://www.idpf.org/2007/ops";
html {
    color-scheme: ${theme.id === 'dark' ? 'dark' : 'light'};
    font-size: ${size}px !important;
    background: ${theme.bg} !important;
    color: ${theme.fg} !important;
    -webkit-text-size-adjust: none;
    text-size-adjust: none;
}
body {
    background: transparent !important;
    color: ${theme.fg} !important;
    ${font.stack ? `font-family: ${font.stack} !important;` : ''}
    font-size: 1rem !important;
    ${stroke ? `-webkit-text-stroke: ${stroke}em currentColor;` : ''}
    font-synthesis: weight style;
    text-rendering: optimizeLegibility;
    font-kerning: normal;
    font-variant-ligatures: common-ligatures;
}
${font.stack ? `body *:not(pre):not(code):not(kbd):not(samp):not(tt):not(math):not(math *) {
    font-family: inherit !important;
}` : ''}
p, li, blockquote, dd, div {
    line-height: ${lh} !important;
}
p, li, blockquote, dd {
    text-align: ${s.justify ? 'justify' : 'start'};
    -webkit-hyphens: ${s.hyphenate ? 'auto' : 'manual'};
    hyphens: ${s.hyphenate ? 'auto' : 'manual'};
    -webkit-hyphenate-limit-before: 3;
    -webkit-hyphenate-limit-after: 2;
    -webkit-hyphenate-limit-lines: 2;
    hanging-punctuation: allow-end last;
    widows: 2;
    orphans: 2;
}
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
[align="justify"] { text-align: justify; }
${forceColors ? `
body *:not(img):not(svg):not(svg *):not(video):not(canvas) {
    color: inherit !important;
    background-color: transparent !important;
    border-color: currentColor;
}
a:link, a:visited { color: ${theme.link} !important; text-decoration: underline; text-decoration-thickness: .06em; text-underline-offset: .15em; }
` : ''}
${imageFilter(s, theme)}
pre { white-space: pre-wrap !important; }
::selection { background: ${theme.id === 'dark' ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.16)'}; }
aside[epub|type~="endnote"],
aside[epub|type~="footnote"],
aside[epub|type~="note"],
aside[epub|type~="rearnote"] { display: none; }
`
}
