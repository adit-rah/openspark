import '../vendor/foliate-js/view.js'
import { Overlayer } from '../vendor/foliate-js/overlayer.js'
import * as CFI from '../vendor/foliate-js/epubcfi.js'
import { db } from './db.js'
import { asFile } from './importer.js'
import {
    settings, bookCSS, FONTS, FONT_SIZES, LINE_SPACING, MARGINS, THEMES, FOOTER_MODES,
} from './settings.js'
import { icon } from './icons.js'
import { light } from './light.js'
import { renderLightControls, resetLightEditing } from './light-ui.js'
import {
    $, h, debounce, toast, percent, formatMinutes, downloadText, storage, promptText, confirmDialog,
} from './util.js'

const HIGHLIGHT_COLORS = [
    ['yellow', '#f5d34a'],
    ['blue', '#7fb8f0'],
    ['pink', '#f29bb8'],
    ['orange', '#f6ac5a'],
]
const colorValue = name => HIGHLIGHT_COLORS.find(([n]) => n === name)?.[1] ?? name
const SVG_NS = 'http://www.w3.org/2000/svg'

const BYTES_PER_LOCATION = 150       // roughly the granularity of a Kindle "location"
const SPEED_KEY = 'openspark:speed'  // reading speed samples, bytes per minute
const MIN_SPEED_SAMPLES = 5

// ---------------------------------------------------------------------------
// Reading-speed estimator: learns from how long you spend on each page,
// like dedicated e-readers do, and estimates time left.
class ReadingSpeed {
    samples = storage.get(SPEED_KEY, [])
    #last = null
    get learned() { return this.samples.length >= MIN_SPEED_SAMPLES }
    get bytesPerMinute() {
        if (!this.samples.length) return 1800
        const s = [...this.samples].sort((a, b) => a - b)
        return s[Math.floor(s.length / 2)]
    }
    reset() { this.#last = null }
    track(bytePos) {
        const now = performance.now()
        const last = this.#last
        this.#last = { pos: bytePos, t: now }
        if (!last || document.hidden) return
        const bytes = bytePos - last.pos, mins = (now - last.t) / 60000
        // ignore skimming, jumping and long breaks
        if (bytes <= 50 || bytes > 6000 || mins < 2.5 / 60 || mins > 4) return
        this.samples.push(bytes / mins)
        if (this.samples.length > 60) this.samples.shift()
        storage.set(SPEED_KEY, this.samples)
    }
    clear() {
        this.samples = []
        storage.set(SPEED_KEY, [])
    }
}

// ---------------------------------------------------------------------------
export class Reader {
    view = null
    book = null
    record = null
    annotations = []      // { id, bookId, type: 'highlight'|'bookmark', cfi, text, note, color, index, chapter, createdAt }
    location = null       // last relocate detail
    chromeVisible = false
    #speed = new ReadingSpeed()
    #pageTurns = 0
    #lastSection = -1
    #suppressTapUntil = 0
    #searchAbort = null
    #searchResults = []
    #wheelLock = 0
    #popupMode = null // 'selection' | 'annotation'
    #onKey = e => this.#handleKey(e)
    #onResize = debounce(() => this.#applyFrame(), 100)

    constructor({ onClose, onProgress }) {
        this.onClose = onClose
        this.onProgress = onProgress
        this.screen = $('#screen')
        this.host = $('#book-host')

        $('#btn-back').innerHTML = icon('back')
        $('#btn-aa').innerHTML = icon('aa')
        $('#btn-light').innerHTML = icon('sun')
        $('#btn-goto').innerHTML = icon('goto')
        $('#btn-search').innerHTML = icon('search')
        $('#btn-notebook').innerHTML = icon('notebook')
        $('#btn-bookmark').innerHTML = icon('bookmark')

        $('#btn-back').addEventListener('click', () => this.onClose())
        $('#btn-aa').addEventListener('click', () => this.openPanel('aa'))
        $('#btn-light').addEventListener('click', () => this.openPanel('light'))
        $('#btn-goto').addEventListener('click', () => this.openPanel('goto'))
        $('#btn-search').addEventListener('click', () => this.openPanel('search'))
        $('#btn-notebook').addEventListener('click', () => this.openPanel('notebook'))
        $('#btn-bookmark').addEventListener('click', () => this.toggleBookmark())
        $('#scrim').addEventListener('click', () => this.closePanels())
        $('#status-left').addEventListener('click', () => this.#cycleFooter())

        const slider = $('#progress-slider')
        slider.addEventListener('input', () => this.#previewSlider(+slider.value))
        slider.addEventListener('change', () => this.view?.goToFraction(+slider.value))

        // taps on the area around the page (margins), outside the book iframe
        this.host.addEventListener('click', e => this.#onTap(e.clientX, e.clientY, e))
        this.host.addEventListener('wheel', e => this.#onWheel(e), { passive: true })

        settings.onChange(patch => {
            if (!this.view) return
            const keys = Object.keys(patch)
            if (keys.some(k => ['font', 'fontSize', 'boldness', 'lineSpacing', 'justify', 'hyphenate',
                'theme', 'grayscale', 'publisherColors'].includes(k))) this.#applyStyles()
            if (keys.some(k => ['margins', 'columns', 'animate'].includes(k))) this.#applyLayout()
            if (keys.some(k => ['theme', 'frame'].includes(k))) this.#applyFrame()
            if (keys.some(k => ['footer', 'showPercent'].includes(k))) this.#renderStatus()
        })
        // front light: warmth, brightness, schedule, dark at night
        light.onChange(() => {
            this.#applyPageColors()
            if (!this.view) return
            this.#applyStyles()
            this.#applyFrame()
            for (const { doc, index } of this.view.renderer.getContents()) {
                this.#injectLightFilter(doc)
                this.#drawAnnotations(index)
            }
        })
        this.#applyPageColors()
    }

    // ------------------------------------------------------------------ open/close
    async open(record) {
        this.record = record
        this.#applyFrame()
        $('#reader-loading').hidden = false
        this.#setChrome(false)
        this.closePanels()
        $('#reader-title').textContent = record.title
        document.title = `${record.title} · OpenSpark`

        const blob = await db.getFile(record.id)
        if (!blob) throw new Error('The book file is missing from storage.')
        this.annotations = await db.getAnnotations(record.id)

        const view = document.createElement('foliate-view')
        this.view = view
        this.host.replaceChildren(view)
        try {
            await view.open(asFile(blob, record))
        } catch (e) {
            this.host.replaceChildren()
            this.view = null
            throw e
        }
        this.book = view.book
        this.totalBytes = view.book.sections.reduce((a, s) => a + (s.linear !== 'no' && s.size > 0 ? s.size : 0), 0)

        // keep broken resources from breaking the whole page
        this.book.transformTarget?.addEventListener('data', ({ detail }) => {
            detail.data = Promise.resolve(detail.data).catch(e => {
                console.warn(`Failed to load ${detail.name}`, e)
                return ''
            })
        })

        view.addEventListener('load', e => this.#onLoad(e.detail))
        view.addEventListener('relocate', e => this.#onRelocate(e.detail))
        view.addEventListener('create-overlay', e => this.#drawAnnotations(e.detail.index))
        view.addEventListener('draw-annotation', e => {
            const { draw, annotation } = e.detail
            if (annotation.type === 'highlight') draw(Overlayer.highlight, { color: light.lit(colorValue(annotation.color)) })
        })
        view.addEventListener('show-annotation', e => this.#onShowAnnotation(e.detail))
        view.addEventListener('external-link', e => {
            // open web links in a new tab, never inside the reader
            e.preventDefault()
            const href = e.detail.href_ ?? e.detail.a?.href
            if (/^https?:/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
        })

        this.#applyLayout()
        this.#applyStyles()

        document.addEventListener('keydown', this.#onKey)
        addEventListener('resize', this.#onResize)
        this.#speed.reset()
        this.#pageTurns = 0
        this.#lastSection = -1

        await view.init({ lastLocation: record.cfi, showTextStart: !record.cfi })
        $('#reader-loading').hidden = true
        db.updateBook(record.id, { lastOpenedAt: Date.now() })
        this.onProgress(record.id, { lastOpenedAt: Date.now() })
        this.view.renderer.focusView?.()
    }

    async close() {
        this.#saveProgress.flush?.()
        document.removeEventListener('keydown', this.#onKey)
        removeEventListener('resize', this.#onResize)
        this.#searchAbort?.abort()
        this.lastQuery = ''
        this.closePanels()
        this.#setChrome(false)
        this.#hidePopup()
        try { this.view?.close() } catch { /* ignore */ }
        try { this.book?.destroy?.() } catch { /* ignore */ }
        this.view?.remove()
        this.view = null
        this.book = null
        this.location = null
        this.record = null
        this.#searchResults = []
        document.title = 'OpenSpark'
    }

    // ------------------------------------------------------------------ styles & layout
    #applyStyles() {
        this.view?.renderer.setStyles?.(bookCSS(settings))
        this.#applyPageColors()
        if (this.view?.isFixedLayout)
            this.view.renderer.style.background = settings.getTheme().bg
    }
    // page colors (with the front light applied) for the reader chrome, menus and dialogs
    #applyPageColors() {
        const theme = settings.getTheme()
        const root = document.documentElement.style
        this.screen.dataset.theme = theme.id
        root.setProperty('--page-bg', theme.bg)
        root.setProperty('--page-fg', theme.fg)
        if (document.body.dataset.view === 'reader')
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg)
    }
    // An SVG color-matrix filter, referenced by the book CSS as url(#os-light), tints
    // images with the front light. It goes after <body> so it can't shift any CFIs.
    #injectLightFilter(doc) {
        let svg = doc.getElementById('os-light-svg')
        if (!svg) {
            svg = doc.createElementNS(SVG_NS, 'svg')
            svg.id = 'os-light-svg'
            svg.setAttribute('aria-hidden', 'true')
            svg.setAttribute('width', '0')
            svg.setAttribute('height', '0')
            svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none')
            const filter = doc.createElementNS(SVG_NS, 'filter')
            filter.id = 'os-light'
            filter.setAttribute('color-interpolation-filters', 'sRGB')
            const matrix = doc.createElementNS(SVG_NS, 'feColorMatrix')
            matrix.setAttribute('type', 'matrix')
            filter.append(matrix)
            svg.append(filter)
            doc.documentElement.append(svg)
        }
        svg.querySelector('feColorMatrix').setAttribute('values', light.matrix())
    }
    #applyLayout() {
        const r = this.view?.renderer
        if (!r || this.view.isFixedLayout) return
        r.setAttribute('flow', 'paginated')
        r.setAttribute('margin', '44px')
        r.setAttribute('gap', MARGINS[settings.margins] ?? '6%')
        r.setAttribute('max-inline-size', '680px')
        r.setAttribute('max-block-size', '2000px')
        r.setAttribute('max-column-count', settings.columns === 'one' ? '1' : '2')
        r.toggleAttribute('animated', !!settings.animate)
    }
    #applyFrame() {
        const wide = innerWidth >= 900 && innerHeight >= 600 && innerWidth / innerHeight > 1.1
        const framed = settings.frame === 'on' || (settings.frame === 'auto' && wide)
        document.body.classList.toggle('framed', framed)
    }

    // ------------------------------------------------------------------ events
    #onLoad({ doc, index }) {
        this.#injectLightFilter(doc)
        doc.addEventListener('keydown', this.#onKey)
        doc.addEventListener('wheel', e => this.#onWheel(e), { passive: true })
        // tap zones: translate iframe coordinates into screen coordinates
        doc.addEventListener('click', e => {
            if (e.target.closest?.('a[href]')) return
            const frame = doc.defaultView.frameElement
            const r = frame.getBoundingClientRect()
            const x = r.left + e.clientX, y = r.top + e.clientY
            // defer so a tap on a highlight (handled by the overlay) can claim it first
            setTimeout(() => this.#onTap(x, y, e))
        })
        // text selection → highlight popup
        const onSelect = () => setTimeout(() => this.#checkSelection(doc, index), 10)
        doc.addEventListener('pointerup', onSelect)
        doc.addEventListener('keyup', e => { if (e.shiftKey) onSelect() })
        doc.addEventListener('selectionchange', debounce(() => {
            const sel = doc.getSelection()
            if ((!sel || sel.isCollapsed) && this.#popupMode === 'selection') this.#hidePopup()
        }, 50))
    }

    #onTap(x, y, e) {
        if (performance.now() < this.#suppressTapUntil) return
        const sel = e?.view?.getSelection?.()
        if (sel && !sel.isCollapsed) return
        if (!$('#sel-popup').hidden) { this.#hidePopup(); return }
        if (this.#anyPanelOpen()) { this.closePanels(); return }
        if (this.chromeVisible) { this.#setChrome(false); return }
        const r = this.screen.getBoundingClientRect()
        const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height
        // top strip opens the toolbar; left edge goes back; everything else turns forward
        if (fy < 0.12) this.#setChrome(true)
        else if (fx < 0.25) this.view?.goLeft()
        else this.view?.goRight()
    }

    #onWheel(e) {
        if (this.#anyPanelOpen() || !this.view) return
        const now = performance.now()
        if (now < this.#wheelLock) return
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        if (Math.abs(d) < 8) return
        this.#wheelLock = now + 350
        d > 0 ? this.view.next() : this.view.prev()
    }

    #handleKey(e) {
        if (!this.view) return
        const tag = (e.target?.tagName ?? '').toLowerCase()
        const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable
        if (e.key === 'Escape') {
            if (!$('#note-dialog').hidden) return
            if (!$('#sel-popup').hidden) return this.#hidePopup()
            if (this.#anyPanelOpen()) return this.closePanels()
            if (this.chromeVisible) return this.#setChrome(false)
            return this.onClose()
        }
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return
        if (this.#anyPanelOpen()) return
        switch (e.key) {
            case 'ArrowLeft': this.view.goLeft(); break
            case 'ArrowRight': this.view.goRight(); break
            case 'ArrowUp': case 'PageUp': case 'k': this.view.prev(); break
            case 'ArrowDown': case 'PageDown': case 'j': this.view.next(); break
            case ' ': e.shiftKey ? this.view.prev() : this.view.next(); break
            case 'b': this.toggleBookmark(); break
            case 'm': case 'Enter': this.#setChrome(!this.chromeVisible); break
            case 'f': case '/': this.openPanel('search'); break
            case 'g': case 't': this.openPanel('goto'); break
            case 'a': this.openPanel('aa'); break
            case 'L': case 'l': this.openPanel('light'); break
            case 'n': this.openPanel('notebook'); break
            default: return
        }
        e.preventDefault()
    }

    #onRelocate(detail) {
        this.location = detail
        const pos = (detail.fraction ?? 0) * this.totalBytes
        const sectionChanged = detail.section?.current !== this.#lastSection
        if (this.#lastSection !== -1) {
            this.#speed.track(pos)
            this.#pageTurns++
            this.#flash(sectionChanged)
        }
        this.#lastSection = detail.section?.current
        this.#hidePopup()
        this.#renderStatus()
        this.#renderBookmarkState()
        if (this.chromeVisible) this.#renderBottom()
        this.#saveProgress()
    }

    #saveProgress = debounce(() => {
        if (!this.record || !this.location) return
        const { cfi, fraction } = this.location
        const atEnd = fraction >= 0.995
        const patch = { cfi, progress: fraction, lastOpenedAt: Date.now() }
        if (atEnd && !this.record.finished) patch.finished = true
        Object.assign(this.record, patch)
        db.updateBook(this.record.id, patch)
        this.onProgress(this.record.id, patch)
    }, 400)

    // e-ink style refresh: briefly flash the screen like a full panel refresh
    #flash(sectionChanged) {
        const mode = settings.flash
        if (mode === 'off') return
        if (mode === 'chapter' && !sectionChanged && this.#pageTurns % 6) return
        const el = $('#flash')
        el.classList.remove('on')
        void el.offsetWidth
        el.classList.add('on')
        setTimeout(() => el.classList.remove('on'), 140)
    }

    // ------------------------------------------------------------------ status line & chrome
    #locationInfo() {
        const loc = this.location
        if (!loc) return null
        const total = Math.max(1, Math.ceil(this.totalBytes / BYTES_PER_LOCATION))
        const current = Math.min(total, Math.floor((loc.fraction * this.totalBytes) / BYTES_PER_LOCATION) + 1)
        return { current, total }
    }
    #timeLeft(kind) {
        const loc = this.location
        if (!loc?.time) return null
        // foliate-js reports remaining size in units of 1600 bytes
        const bytes = (kind === 'section' ? loc.time.section : loc.time.total) * 1600
        return bytes / this.#speed.bytesPerMinute
    }
    #statusText(mode) {
        const loc = this.location
        if (!loc) return ''
        // comics & fixed-layout books: byte-based estimates mean nothing, show pages
        if (this.view?.isFixedLayout) return mode === 'none' ? ''
            : `Page ${(loc.section?.current ?? 0) + 1} of ${loc.section?.total ?? this.book.sections.length}`
        switch (mode) {
            case 'chapter-time': {
                if (!this.#speed.learned) return 'Learning reading speed'
                const m = this.#timeLeft('section')
                return m < 1 ? 'Less than a minute left in chapter' : `${formatMinutes(m)} left in chapter`
            }
            case 'book-time': {
                if (!this.#speed.learned) return 'Learning reading speed'
                const m = this.#timeLeft('total')
                return m < 1 ? 'Less than a minute left in book' : `${formatMinutes(m)} left in book`
            }
            case 'location': {
                const l = this.#locationInfo()
                return l ? `Location ${l.current.toLocaleString()} of ${l.total.toLocaleString()}` : ''
            }
            case 'page':
                if (loc.pageItem?.label) {
                    const total = this.book?.pageList?.length
                    return `Page ${loc.pageItem.label}${total ? ` of ${this.book.pageList.at(-1)?.label ?? total}` : ''}`
                }
                return this.#statusText('location')
            default: return ''
        }
    }
    #renderStatus() {
        const left = $('#status-left'), right = $('#status-right')
        left.textContent = this.#statusText(settings.footer)
        left.classList.toggle('empty', settings.footer === 'none')
        right.textContent = settings.showPercent && this.location ? percent(this.location.fraction) : ''
    }
    #cycleFooter() {
        const modes = FOOTER_MODES.map(m => m[0]).filter(m => m !== 'page' || this.book?.pageList?.length)
        const i = modes.indexOf(settings.footer)
        settings.set({ footer: modes[(i + 1) % modes.length] })
    }

    #setChrome(show) {
        this.chromeVisible = show
        $('#reader-top').hidden = !show
        $('#reader-bottom').hidden = !show
        this.screen.classList.toggle('chrome-on', show)
        if (show) this.#renderBottom()
        else this.view?.renderer.focusView?.()
    }
    #renderBottom() {
        const loc = this.location
        if (!loc) return
        $('#bottom-chapter').textContent = loc.tocItem?.label?.trim() ?? ''
        const slider = $('#progress-slider')
        slider.value = loc.fraction
        slider.dir = this.book?.dir === 'rtl' ? 'rtl' : 'ltr'
        const l = this.#locationInfo()
        const page = loc.pageItem?.label ? `Page ${loc.pageItem.label} · ` : ''
        $('#bottom-meta').textContent = `${page}Location ${l.current.toLocaleString()} of ${l.total.toLocaleString()} · ${percent(loc.fraction)}`
    }
    #previewSlider(fraction) {
        const total = Math.max(1, Math.ceil(this.totalBytes / BYTES_PER_LOCATION))
        const current = Math.min(total, Math.floor(fraction * total) + 1)
        $('#bottom-meta').textContent = `Location ${current.toLocaleString()} of ${total.toLocaleString()} · ${percent(fraction)}`
    }

    // ------------------------------------------------------------------ panels
    // jump somewhere from a panel: close everything and go
    #navigate(target) {
        this.closePanels()
        this.#setChrome(false)
        const p = typeof target === 'function' ? target() : this.view.goTo(target)
        return Promise.resolve(p).catch(e => console.error(e))
    }
    #anyPanelOpen() {
        return ['#panel-aa', '#panel-light', '#panel-goto', '#panel-search', '#panel-notebook']
            .some(s => !$(s).hidden)
    }
    closePanels() {
        if (!$('#panel-light').hidden) resetLightEditing()
        for (const s of ['#panel-aa', '#panel-light', '#panel-goto', '#panel-search', '#panel-notebook']) $(s).hidden = true
        $('#scrim').hidden = true
    }
    openPanel(name) {
        if (!this.view) return
        const el = $(`#panel-${name}`)
        const wasOpen = !el.hidden
        this.closePanels()
        if (wasOpen) return
        this.#hidePopup()
        ;({
            aa: () => this.#renderAa(),
            light: () => this.#renderLight(),
            goto: () => this.#renderGoto(),
            search: () => this.#renderSearch(),
            notebook: () => this.#renderNotebook(),
        })[name]()
        el.hidden = false
        $('#scrim').hidden = false
        el.querySelector('[autofocus]')?.focus()
    }
    #panelHeader(title, extra) {
        return h('div', { class: 'panel-header' },
            h('h2', {}, title),
            extra ?? null,
            h('button', { class: 'icon-btn', 'aria-label': 'Close', html: icon('close'), onclick: () => this.closePanels() }))
    }

    // ---- Aa (display settings)
    #aaTab = 'font'
    #renderAa() {
        const el = $('#panel-aa')
        const tabs = [['font', 'Font'], ['layout', 'Layout'], ['themes', 'Themes'], ['more', 'More']]
        const seg = (options, current, onPick, cls = '') => h('div', { class: `segmented ${cls}` },
            options.map(([value, label, extra]) => h('button', {
                class: `seg${value === current ? ' active' : ''}`,
                'aria-pressed': String(value === current),
                onclick: () => { onPick(value); this.#renderAa() },
                ...extra,
            }, label)))
        const row = (label, control) => h('div', { class: 'setting-row' }, h('div', { class: 'setting-label' }, label), control)

        let body
        if (this.#aaTab === 'font') {
            const sizeIdx = settings.fontSize
            body = h('div', {},
                h('div', { class: 'font-list' }, FONTS.map(f => h('button', {
                    class: `font-choice${settings.font === f.id ? ' active' : ''}`,
                    style: f.stack ? { fontFamily: f.stack } : {},
                    onclick: () => { settings.set({ font: f.id }); this.#renderAa() },
                }, f.label))),
                row('Size', h('div', { class: 'stepper' },
                    h('button', { class: 'step-btn small-a', 'aria-label': 'Smaller text', disabled: sizeIdx <= 0,
                        onclick: () => { settings.set({ fontSize: Math.max(0, sizeIdx - 1) }); this.#renderAa() } }, 'A'),
                    h('div', { class: 'step-dots', role: 'presentation' }, FONT_SIZES.map((_, i) => h('button', {
                        class: `dot${i <= sizeIdx ? ' on' : ''}`,
                        'aria-label': `Size ${i + 1}`,
                        onclick: () => { settings.set({ fontSize: i }); this.#renderAa() },
                    }))),
                    h('button', { class: 'step-btn big-a', 'aria-label': 'Larger text', disabled: sizeIdx >= FONT_SIZES.length - 1,
                        onclick: () => { settings.set({ fontSize: Math.min(FONT_SIZES.length - 1, sizeIdx + 1) }); this.#renderAa() } }, 'A'))),
                row('Boldness', seg([[0, 'Off'], [1, '1'], [2, '2'], [3, '3']], settings.boldness, v => settings.set({ boldness: v }))))
        } else if (this.#aaTab === 'layout') {
            body = h('div', {},
                row('Spacing', seg(Object.keys(LINE_SPACING).map(k => [k, k[0].toUpperCase() + k.slice(1)]), settings.lineSpacing, v => settings.set({ lineSpacing: v }))),
                row('Margins', seg(Object.keys(MARGINS).map(k => [k, k[0].toUpperCase() + k.slice(1)]), settings.margins, v => settings.set({ margins: v }))),
                row('Alignment', seg([[false, 'Left'], [true, 'Justified']], settings.justify, v => settings.set({ justify: v }))),
                row('Hyphenation', seg([[true, 'On'], [false, 'Off']], settings.hyphenate, v => settings.set({ hyphenate: v }))),
                row('Columns', seg([['auto', 'Auto'], ['one', 'Single']], settings.columns, v => settings.set({ columns: v }))),
                row('Page turn', seg([[false, 'Instant'], [true, 'Slide']], settings.animate, v => settings.set({ animate: v }))))
        } else if (this.#aaTab === 'themes') {
            body = h('div', {},
                h('div', { class: 'theme-list' }, THEMES.map(t => h('button', {
                    class: `theme-choice${settings.theme === t.id ? ' active' : ''}`,
                    style: { background: t.bg, color: t.fg },
                    onclick: () => { settings.set({ theme: t.id }); this.#renderAa() },
                }, h('span', { class: 'theme-aa' }, 'Aa'), h('span', {}, t.label)))),
                row('Images', seg([[false, 'Color'], [true, 'Grayscale']], settings.grayscale, v => settings.set({ grayscale: v }))),
                row('Book colors', seg([[false, 'Override'], [true, 'Publisher']], settings.publisherColors, v => settings.set({ publisherColors: v }))),
                row('Device frame', seg([['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], settings.frame, v => settings.set({ frame: v }))))
        } else {
            body = h('div', {},
                row('Reading progress', h('select', {
                    class: 'select',
                    onchange: e => settings.set({ footer: e.target.value }),
                }, FOOTER_MODES.map(([v, l]) => h('option', { value: v, selected: settings.footer === v }, l)))),
                row('Show percentage', seg([[true, 'On'], [false, 'Off']], settings.showPercent, v => settings.set({ showPercent: v }))),
                row('Screen refresh', seg([['off', 'Off'], ['chapter', 'Occasional'], ['page', 'Every page']], settings.flash, v => settings.set({ flash: v }))),
                h('p', { class: 'setting-hint' }, 'Screen refresh imitates the brief black flash of an e-ink display.'),
                row('Reading speed', h('button', {
                    class: 'btn btn-ghost',
                    onclick: () => { this.#speed.clear(); this.#renderStatus(); toast('Reading speed reset') },
                }, 'Reset')))
        }
        el.replaceChildren(
            h('div', { class: 'sheet-handle' }),
            h('div', { class: 'aa-tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', {
                class: `aa-tab${this.#aaTab === id ? ' active' : ''}`, role: 'tab',
                'aria-selected': String(this.#aaTab === id),
                onclick: () => { this.#aaTab = id; this.#renderAa() },
            }, label))),
            h('div', { class: 'aa-body' }, body))
    }

    // ---- Light (brightness & warmth)
    #renderLight() {
        $('#panel-light').replaceChildren(
            h('div', { class: 'sheet-handle' }),
            this.#panelHeader('Light'),
            h('div', { class: 'aa-body' }, renderLightControls(() => this.#renderLight())))
    }

    // ---- Go to (table of contents)
    #renderGoto() {
        const el = $('#panel-goto')
        const current = this.location?.tocItem?.href
        const list = h('nav', { class: 'toc' })
        let currentEl = null
        const walk = (items, depth) => {
            for (const item of items ?? []) {
                const isCurrent = item.href === current
                const btn = h('button', {
                    class: `toc-item${isCurrent ? ' current' : ''}`,
                    style: { paddingInlineStart: `${16 + depth * 18}px` },
                    onclick: () => this.#navigate(item.href),
                }, item.label?.trim() || 'Untitled')
                if (isCurrent) currentEl = btn
                list.append(btn)
                if (item.subitems?.length) walk(item.subitems, depth + 1)
            }
        }
        walk(this.book.toc, 0)
        if (!list.children.length) list.append(h('p', { class: 'muted pad' }, 'This book has no table of contents.'))

        const l = this.#locationInfo()
        const input = h('input', {
            class: 'text-input', type: 'text', inputmode: 'decimal',
            placeholder: `Location (1–${l?.total ?? '?'}) or percent (e.g. 50%)`,
        })
        const go = () => {
            const v = input.value.trim()
            if (!v) return
            let f
            if (v.endsWith('%')) f = parseFloat(v) / 100
            else {
                const n = parseInt(v, 10)
                if (Number.isFinite(n) && l) f = (n - 1) / l.total
            }
            if (!Number.isFinite(f)) return toast('Enter a location number or a percentage')
            this.#navigate(() => this.view.goToFraction(Math.max(0, Math.min(1, f))))
        }
        input.addEventListener('keydown', e => { if (e.key === 'Enter') go() })

        el.replaceChildren(
            this.#panelHeader('Go to'),
            h('div', { class: 'goto-quick' },
                h('button', { class: 'chip', onclick: () => this.#navigate(0) }, 'Cover'),
                h('button', { class: 'chip', onclick: () => this.#navigate(() => this.view.goToTextStart()) }, 'Beginning'),
                h('button', { class: 'chip', disabled: !this.view.history.canGoBack, onclick: () =>
                    this.#navigate(() => this.view.history.back()) }, 'Previous position')),
            h('div', { class: 'goto-input' }, input, h('button', { class: 'btn', onclick: go }, 'Go')),
            h('div', { class: 'panel-section-title' }, 'Contents'),
            list)
        requestAnimationFrame(() => currentEl?.scrollIntoView({ block: 'center' }))
    }

    // ---- Search
    #renderSearch() {
        const el = $('#panel-search')
        const input = h('input', { class: 'text-input', type: 'search', placeholder: 'Search this book', autofocus: true, value: this.lastQuery ?? '' })
        const status = h('div', { class: 'search-status muted' })
        const results = h('div', { class: 'search-results' })
        const renderResults = () => {
            results.replaceChildren(...this.#searchResults.map(group => h('div', { class: 'search-group' },
                group.label ? h('div', { class: 'panel-section-title' }, group.label) : null,
                group.subitems.map(r => h('button', {
                    class: 'search-hit',
                    onclick: () => this.#navigate(r.cfi),
                }, r.excerpt.pre, h('mark', {}, r.excerpt.match), r.excerpt.post)))))
        }
        const run = async () => {
            const query = input.value.trim()
            this.#searchAbort?.abort()
            this.view.clearSearch()
            this.#searchResults = []
            renderResults()
            this.lastQuery = query
            if (!query) { status.textContent = ''; return }
            const ctrl = new AbortController()
            this.#searchAbort = ctrl
            status.textContent = 'Searching…'
            let count = 0
            try {
                const drawOptions = { color: settings.getTheme().fg, width: 2, radius: 3, padding: 2 }
                for await (const r of this.view.search({ query, matchCase: false, matchDiacritics: false, matchWholeWords: false, drawOptions })) {
                    if (ctrl.signal.aborted) return
                    if (r === 'done') break
                    if (r.progress != null) { status.textContent = `Searching… ${percent(r.progress)}`; continue }
                    if (r.subitems) {
                        count += r.subitems.length
                        this.#searchResults.push(r)
                        renderResults()
                    }
                }
                status.textContent = count ? `${count} result${count === 1 ? '' : 's'}` : 'No results'
            } catch (e) {
                console.error(e)
                status.textContent = 'Search failed'
            }
        }
        input.addEventListener('keydown', e => { if (e.key === 'Enter') run() })
        input.addEventListener('search', () => { if (!input.value) run() })
        el.replaceChildren(
            this.#panelHeader('Search'),
            h('div', { class: 'goto-input' }, input, h('button', { class: 'btn', onclick: run }, 'Search')),
            status, results)
        if (this.#searchResults.length) {
            renderResults()
            status.textContent = `${this.#searchResults.reduce((a, g) => a + g.subitems.length, 0)} results`
        }
    }

    // ---- Annotations: bookmarks & highlights
    #sortedAnnotations() {
        return [...this.annotations].sort((a, b) => {
            try { return CFI.compare(a.cfi, b.cfi) } catch { return 0 }
        })
    }
    async #drawAnnotations(index) {
        for (const a of this.annotations)
            if (a.type === 'highlight' && a.index === index) this.view.addAnnotation({ ...a, value: a.cfi })
    }
    #pageRangeCFIs() {
        const loc = this.location
        if (!loc?.range) return null
        const index = loc.section?.current ?? this.view.renderer.getContents()[0]?.index
        const start = loc.range.cloneRange(); start.collapse(true)
        const end = loc.range.cloneRange(); end.collapse(false)
        return { index, start: this.view.getCFI(index, start), end: this.view.getCFI(index, end) }
    }
    #bookmarkOnPage() {
        const page = this.#pageRangeCFIs()
        if (!page) return null
        return this.annotations.find(a => {
            if (a.type !== 'bookmark') return false
            try { return CFI.compare(a.cfi, page.start) >= 0 && CFI.compare(a.cfi, page.end) <= 0 } catch { return false }
        }) ?? null
    }
    #renderBookmarkState() {
        const on = !!this.#bookmarkOnPage()
        $('#bookmark-ribbon').hidden = !on
        $('#btn-bookmark').innerHTML = icon(on ? 'bookmarkFilled' : 'bookmark')
        $('#btn-bookmark').title = on ? 'Remove bookmark' : 'Add bookmark'
        $('#btn-bookmark').setAttribute('aria-pressed', String(on))
    }
    async toggleBookmark() {
        if (!this.view || !this.location) return
        const existing = this.#bookmarkOnPage()
        if (existing) {
            await db.deleteAnnotation(existing.id)
            this.annotations = this.annotations.filter(a => a.id !== existing.id)
            toast('Bookmark removed')
        } else {
            const page = this.#pageRangeCFIs()
            if (!page) return
            const text = this.location.range.toString().replace(/\s+/g, ' ').trim().slice(0, 160)
            const a = {
                id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()),
                bookId: this.record.id, type: 'bookmark', cfi: page.start, index: page.index,
                text, chapter: this.location.tocItem?.label?.trim() ?? '', createdAt: Date.now(),
                location: this.#locationInfo()?.current,
            }
            await db.putAnnotation(a)
            this.annotations.push(a)
            toast('Bookmark added')
        }
        this.#renderBookmarkState()
        if (!$('#panel-notebook').hidden) this.#renderNotebook()
    }

    #checkSelection(doc, index) {
        const sel = doc.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) return
        const range = sel.getRangeAt(0)
        const text = range.toString().trim()
        if (!text) return
        this.#showSelectionPopup({ doc, index, range, text })
    }
    #popupPosition(range, doc) {
        const frame = doc.defaultView.frameElement.getBoundingClientRect()
        const rects = Array.from(range.getClientRects())
        const first = rects[0] ?? range.getBoundingClientRect()
        const last = rects.at(-1) ?? first
        const screen = this.screen.getBoundingClientRect()
        return {
            top: frame.top + first.top - screen.top,
            bottom: frame.top + last.bottom - screen.top,
            x: frame.left + (first.left + last.right) / 2 - screen.left,
        }
    }
    #placePopup(pop, pos) {
        pop.hidden = false
        const screen = this.screen.getBoundingClientRect()
        const w = pop.offsetWidth, hgt = pop.offsetHeight
        let top = pos.top - hgt - 12
        if (top < 8) top = pos.bottom + 12
        if (top + hgt > screen.height - 8) top = Math.max(8, screen.height - hgt - 8)
        pop.style.top = `${top}px`
        pop.style.left = `${Math.max(8, Math.min(screen.width - w - 8, pos.x - w / 2))}px`
    }
    #showSelectionPopup({ doc, index, range, text }) {
        const pop = $('#sel-popup')
        const cfi = this.view.getCFI(index, range)
        const create = async (color, note) => {
            const a = {
                id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()),
                bookId: this.record.id, type: 'highlight', cfi, index, text, color, note: note ?? '',
                chapter: this.view.getProgressOf(index, range)?.tocItem?.label?.trim() ?? '',
                createdAt: Date.now(),
                location: this.#locationInfo()?.current,
            }
            await db.putAnnotation(a)
            this.annotations.push(a)
            this.view.addAnnotation({ ...a, value: a.cfi })
            doc.getSelection().removeAllRanges()
            this.#hidePopup()
            return a
        }
        pop.replaceChildren(
            h('div', { class: 'popup-colors' }, HIGHLIGHT_COLORS.map(([name, value]) => h('button', {
                class: 'swatch', style: { background: light.lit(value) }, title: `Highlight ${name}`, 'aria-label': `Highlight ${name}`,
                onclick: () => create(name),
            }))),
            h('div', { class: 'popup-actions' },
                h('button', { class: 'popup-btn', onclick: async () => {
                    const note = await this.#editNote('')
                    if (note != null) await create('yellow', note)
                } }, h('span', { html: icon('note') }), 'Note'),
                h('button', { class: 'popup-btn', onclick: async () => {
                    try { await navigator.clipboard.writeText(text); toast('Copied') } catch { toast('Could not copy') }
                    doc.getSelection().removeAllRanges()
                    this.#hidePopup()
                } }, h('span', { html: icon('copy') }), 'Copy'),
                h('button', { class: 'popup-btn', onclick: () => {
                    this.lastQuery = text.slice(0, 100)
                    doc.getSelection().removeAllRanges()
                    this.#hidePopup()
                    this.openPanel('search')
                    $('#panel-search input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
                } }, h('span', { html: icon('search') }), 'Search')))
        this.#popupMode = 'selection'
        this.#placePopup(pop, this.#popupPosition(range, doc))
    }
    #onShowAnnotation({ value, range, index }) {
        this.#suppressTapUntil = performance.now() + 400
        const a = this.annotations.find(x => x.cfi === value)
        if (!a) return
        const doc = this.view.renderer.getContents().find(c => c.index === index)?.doc
        if (!doc || !range) return
        const pop = $('#sel-popup')
        const update = async patch => {
            Object.assign(a, patch)
            await db.putAnnotation(a)
            this.view.addAnnotation({ ...a, value: a.cfi })
        }
        pop.replaceChildren(
            h('div', { class: 'popup-colors' }, HIGHLIGHT_COLORS.map(([name, val]) => h('button', {
                class: `swatch${a.color === name ? ' active' : ''}`, style: { background: light.lit(val) }, 'aria-label': `Change to ${name}`,
                onclick: async () => { await update({ color: name }); this.#hidePopup() },
            }))),
            a.note ? h('div', { class: 'popup-note' }, a.note) : null,
            h('div', { class: 'popup-actions' },
                h('button', { class: 'popup-btn', onclick: async () => {
                    const note = await this.#editNote(a.note ?? '')
                    if (note != null) await update({ note })
                    this.#hidePopup()
                } }, h('span', { html: icon('note') }), a.note ? 'Edit note' : 'Add note'),
                h('button', { class: 'popup-btn', onclick: async () => {
                    await this.#deleteAnnotation(a)
                    this.#hidePopup()
                } }, h('span', { html: icon('trash') }), 'Delete')))
        this.#popupMode = 'annotation'
        this.#placePopup(pop, this.#popupPosition(range, doc))
    }
    #hidePopup() {
        this.#popupMode = null
        $('#sel-popup').hidden = true
    }
    async #deleteAnnotation(a) {
        await db.deleteAnnotation(a.id)
        this.annotations = this.annotations.filter(x => x.id !== a.id)
        if (a.type === 'highlight') this.view?.deleteAnnotation({ ...a, value: a.cfi })
        this.#renderBookmarkState()
    }
    #editNote(value) {
        return promptText('Note', { value, placeholder: 'Write a note…', multiline: true, ok: 'Save' })
    }

    // ---- Notebook
    #notebookFilter = 'all'
    #renderNotebook() {
        const el = $('#panel-notebook')
        const items = this.#sortedAnnotations().filter(a =>
            this.#notebookFilter === 'all' || a.type === this.#notebookFilter
            || (this.#notebookFilter === 'note' && a.note))
        const filters = [['all', 'All'], ['highlight', 'Highlights'], ['note', 'Notes'], ['bookmark', 'Bookmarks']]
        el.replaceChildren(
            this.#panelHeader('Notebook', h('button', {
                class: 'icon-btn', title: 'Export notes and highlights', 'aria-label': 'Export notes and highlights',
                html: icon('download'), onclick: () => this.#exportNotes(),
            })),
            h('div', { class: 'goto-quick' }, filters.map(([id, label]) => h('button', {
                class: `chip${this.#notebookFilter === id ? ' active' : ''}`,
                onclick: () => { this.#notebookFilter = id; this.#renderNotebook() },
            }, label))),
            items.length ? h('div', { class: 'notes' }, items.map(a => h('div', { class: 'note-card' },
                h('div', { class: 'note-meta' },
                    h('span', { class: `note-kind ${a.type}` },
                        a.type === 'bookmark' ? 'Bookmark' : a.note ? 'Note' : 'Highlight'),
                    a.type === 'highlight' ? h('span', { class: 'note-dot', style: { background: light.lit(colorValue(a.color)) } }) : null,
                    h('span', { class: 'muted' }, [a.chapter, a.location ? `Location ${a.location.toLocaleString()}` : ''].filter(Boolean).join(' · ')),
                    h('button', {
                        class: 'icon-btn small', 'aria-label': 'Delete', title: 'Delete', html: icon('trash'),
                        onclick: async e => {
                            e.stopPropagation()
                            if (!await confirmDialog('Delete?', `This ${a.type} will be removed.`, { ok: 'Delete', danger: true })) return
                            await this.#deleteAnnotation(a)
                            this.#renderNotebook()
                        },
                    })),
                h('button', {
                    class: 'note-text', onclick: () => this.#navigate(a.cfi),
                }, a.text || '(no text)'),
                a.note ? h('div', { class: 'note-note' }, a.note) : null)))
                : h('p', { class: 'muted pad' }, this.#notebookFilter === 'bookmark'
                    ? 'No bookmarks yet. Tap the bookmark icon in the toolbar, or press B.'
                    : 'No highlights yet. Select some text to highlight it or add a note.'))
    }
    #exportNotes() {
        const r = this.record
        const items = this.#sortedAnnotations()
        if (!items.length) return toast('Nothing to export yet')
        // the classic e-reader "clippings" format, readable by many tools
        const title = `${r.title}${r.author ? ` (${r.author})` : ''}`
        const date = ts => new Date(ts).toLocaleString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
        })
        const out = []
        for (const a of items) {
            const kind = a.type === 'bookmark' ? 'Bookmark' : 'Highlight'
            out.push(title,
                `- Your ${kind}${a.location ? ` at location ${a.location}` : ''} | Added on ${date(a.createdAt)}`,
                '', a.type === 'bookmark' ? '' : a.text, '==========')
            if (a.note) out.push(title,
                `- Your Note${a.location ? ` at location ${a.location}` : ''} | Added on ${date(a.createdAt)}`,
                '', a.note, '==========')
        }
        downloadText(`${r.title.replace(/[\\/:*?"<>|]+/g, '_')} - Clippings.txt`, out.join('\r\n') + '\r\n')
    }
}
