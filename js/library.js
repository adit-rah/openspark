import { db } from './db.js'
import { importFile, isSupported, DRMError, SUPPORTED_EXT } from './importer.js'
import { settings } from './settings.js'
import { icon } from './icons.js'
import {
    $, h, toast, showMenu, modal, promptText, confirmDialog,
    titleSortKey, authorSortKey, formatBytes, formatDate, percent, storage,
} from './util.js'

const COLL_KEY = 'openspark:collections'

const TABS = [
    ['all', 'All'],
    ['reading', 'Reading'],
    ['unread', 'Unread'],
    ['finished', 'Finished'],
    ['collections', 'Collections'],
]

const SORTS = [
    ['recent', 'Recent'],
    ['title', 'Title'],
    ['author', 'Author'],
    ['series', 'Series'],
    ['added', 'Date added'],
]

export class Library {
    books = []
    query = ''
    collection = null // currently opened collection name
    #coverURLs = new Map()

    constructor({ onOpen }) {
        this.onOpen = onOpen
        this.grid = $('#lib-grid')

        $('#btn-add').addEventListener('click', () => $('#file-input').click())
        $('#btn-add-empty').addEventListener('click', () => $('#file-input').click())
        $('#file-input').addEventListener('change', e => {
            this.addFiles(Array.from(e.target.files))
            e.target.value = ''
        })
        $('#lib-search').addEventListener('input', e => {
            this.query = e.target.value.trim().toLowerCase()
            this.render()
        })
        $('#btn-view-mode').addEventListener('click', () => {
            settings.set({ libView: settings.libView === 'grid' ? 'list' : 'grid' })
            this.render()
        })
        $('#btn-sort').innerHTML = icon('sort')
        $('#btn-sort').addEventListener('click', e => this.#sortMenu(e.currentTarget))
        this.#setupDrop()
    }

    async load() {
        this.books = await db.getBooks()
        this.render()
    }

    // ---------- importing
    async addFiles(files) {
        const supported = files.filter(isSupported)
        const skipped = files.length - supported.length
        if (!supported.length) {
            toast(`Unsupported file. Use ${SUPPORTED_EXT.map(x => '.' + x).join(', ')}`, 4000)
            return
        }
        let added = 0, dupes = 0
        const failed = []
        for (const [i, file] of supported.entries()) {
            toast(`Adding ${i + 1} of ${supported.length}: ${file.name}`, 60000)
            try {
                const { record, blob } = await importFile(file)
                const existing = this.books.find(b => b.id === record.id)
                if (existing) { dupes++; continue }
                if (this.collection) record.collections = [this.collection]
                await db.addBook(record, blob)
                this.books.push(record)
                added++
                this.render()
            } catch (e) {
                console.error(e)
                failed.push(e instanceof DRMError
                    ? `${file.name}: protected by DRM (only DRM-free books can be opened)`
                    : `${file.name}: ${e.message || 'could not be read'}`)
            }
        }
        const parts = []
        if (added) parts.push(`Added ${added} book${added === 1 ? '' : 's'}`)
        if (dupes) parts.push(`${dupes} already in library`)
        if (skipped) parts.push(`${skipped} unsupported skipped`)
        toast(parts.join(' · ') || 'Nothing added')
        if (failed.length) modal({
            title: 'Some files could not be added',
            body: h('ul', { class: 'error-list' }, failed.map(f => h('li', {}, f))),
            actions: [{ label: 'OK', primary: true }],
        })
        this.render()
    }

    #setupDrop() {
        const overlay = $('#drop-overlay')
        let depth = 0
        const isFiles = e => Array.from(e.dataTransfer?.types ?? []).includes('Files')
        const lib = $('#library')
        lib.addEventListener('dragenter', e => {
            if (!isFiles(e)) return
            e.preventDefault()
            depth++
            overlay.hidden = false
        })
        lib.addEventListener('dragover', e => { if (isFiles(e)) e.preventDefault() })
        lib.addEventListener('dragleave', () => {
            if (--depth <= 0) { depth = 0; overlay.hidden = true }
        })
        lib.addEventListener('drop', e => {
            if (!isFiles(e)) return
            e.preventDefault()
            depth = 0
            overlay.hidden = true
            this.addFiles(Array.from(e.dataTransfer.files))
        })
    }

    // ---------- collections
    get collectionNames() {
        const names = new Set(storage.get(COLL_KEY, []))
        for (const b of this.books) for (const c of b.collections ?? []) names.add(c)
        return [...names].sort((a, b) => a.localeCompare(b))
    }
    #saveCollectionNames(names) {
        storage.set(COLL_KEY, [...new Set(names)])
    }
    async #newCollection() {
        const name = (await promptText('New collection', { placeholder: 'Collection name', ok: 'Create' }))?.trim()
        if (!name) return null
        this.#saveCollectionNames([...this.collectionNames, name])
        return name
    }
    async #renameCollection(oldName) {
        const name = (await promptText('Rename collection', { value: oldName, ok: 'Rename' }))?.trim()
        if (!name || name === oldName) return
        this.#saveCollectionNames(this.collectionNames.map(n => n === oldName ? name : n))
        for (const b of this.books) if (b.collections?.includes(oldName)) {
            b.collections = [...new Set(b.collections.map(c => c === oldName ? name : c))]
            await db.updateBook(b.id, { collections: b.collections })
        }
        if (this.collection === oldName) this.collection = name
        this.render()
    }
    async #deleteCollection(name) {
        if (!await confirmDialog('Delete collection?',
            `“${name}” will be removed. The books in it stay in your library.`, { ok: 'Delete', danger: true })) return
        this.#saveCollectionNames(this.collectionNames.filter(n => n !== name))
        for (const b of this.books) if (b.collections?.includes(name)) {
            b.collections = b.collections.filter(c => c !== name)
            await db.updateBook(b.id, { collections: b.collections })
        }
        if (this.collection === name) this.collection = null
        this.render()
    }
    async #manageBookCollections(book) {
        const render = () => h('div', { class: 'coll-picker' },
            this.collectionNames.length ? this.collectionNames.map(name => {
                const cb = h('input', { type: 'checkbox', checked: book.collections?.includes(name) })
                cb.addEventListener('change', async () => {
                    const set = new Set(book.collections ?? [])
                    cb.checked ? set.add(name) : set.delete(name)
                    book.collections = [...set]
                    await db.updateBook(book.id, { collections: book.collections })
                    this.render()
                })
                return h('label', { class: 'check-row' }, cb, h('span', {}, name))
            }) : h('p', { class: 'muted' }, 'No collections yet.'),
            h('button', {
                class: 'btn btn-ghost', onclick: async () => {
                    const name = await this.#newCollection()
                    if (name) {
                        book.collections = [...new Set([...(book.collections ?? []), name])]
                        await db.updateBook(book.id, { collections: book.collections })
                        this.render()
                    }
                    close?.()
                    this.#manageBookCollections(book)
                },
            }, h('span', { class: 'btn-icon', html: icon('plus') }), 'New collection'))
        const close = modal({
            title: 'Add to collection',
            body: render(),
            actions: [{ label: 'Done', primary: true }],
        })
    }

    // ---------- book actions
    #bookMenu(book, anchor) {
        showMenu(anchor, [
            { label: 'Open', onClick: () => this.onOpen(book.id) },
            { label: 'Add to collection…', onClick: () => this.#manageBookCollections(book) },
            book.finished
                ? { label: 'Mark as unread', onClick: () => this.#update(book, { finished: false, progress: 0, cfi: null, lastOpenedAt: 0 }) }
                : { label: 'Mark as finished', onClick: () => this.#update(book, { finished: true }) },
            this.collection ? { label: `Remove from “${this.collection}”`, onClick: () =>
                this.#update(book, { collections: (book.collections ?? []).filter(c => c !== this.collection) }) } : null,
            { label: 'Book details', onClick: () => this.#details(book) },
            { separator: true },
            { label: 'Remove from library', danger: true, onClick: () => this.#remove(book) },
        ].filter(Boolean), { align: 'left' })
    }
    async #update(book, patch) {
        Object.assign(book, patch)
        await db.updateBook(book.id, patch)
        this.render()
    }
    async #remove(book) {
        if (!await confirmDialog('Remove book?',
            `“${book.title}” and its notes and highlights will be deleted from this device.`,
            { ok: 'Remove', danger: true })) return
        await db.deleteBook(book.id)
        this.books = this.books.filter(b => b.id !== book.id)
        URL.revokeObjectURL(this.#coverURLs.get(book.id))
        this.#coverURLs.delete(book.id)
        this.render()
        toast('Removed')
    }
    #details(book) {
        const row = (k, v) => v ? h('div', { class: 'detail-row' }, h('dt', {}, k), h('dd', {}, v)) : null
        const desc = h('div', { class: 'detail-desc' })
        // descriptions are often HTML; show as text only
        desc.textContent = new DOMParser().parseFromString(book.description || '', 'text/html').body.textContent.trim()
        modal({
            title: book.title,
            body: h('div', { class: 'details' },
                h('div', { class: 'details-top' }, this.#cover(book),
                    h('dl', {},
                        row('Author', book.author),
                        row('Series', book.series ? `${book.series.name}${book.series.position != null ? ` #${book.series.position}` : ''}` : ''),
                        row('Publisher', book.publisher),
                        row('Published', book.published ? String(book.published).slice(0, 10) : ''),
                        row('Language', book.language),
                        row('Format', `${book.format} · ${formatBytes(book.size)}`),
                        row('Added', formatDate(book.addedAt)),
                        row('Progress', book.finished ? 'Finished' : percent(book.progress)),
                        row('Collections', (book.collections ?? []).join(', ')))),
                desc.textContent ? desc : null),
            actions: [{ label: 'Close' }, { label: 'Read', primary: true, value: 'read' }],
            onClose: v => { if (v === 'read') this.onOpen(book.id) },
        })
    }

    // ---------- filtering & sorting
    #visibleBooks() {
        const f = settings.libFilter
        let list = this.books
        if (this.collection) list = list.filter(b => b.collections?.includes(this.collection))
        else if (f === 'reading') list = list.filter(b => !b.finished && (b.progress > 0 || b.lastOpenedAt))
        else if (f === 'unread') list = list.filter(b => !b.finished && !b.progress && !b.lastOpenedAt)
        else if (f === 'finished') list = list.filter(b => b.finished)
        if (this.query) list = list.filter(b =>
            [b.title, b.author, b.series?.name, ...(b.collections ?? [])]
                .some(x => x?.toLowerCase().includes(this.query)))
        const by = {
            recent: (a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt),
            added: (a, b) => b.addedAt - a.addedAt,
            title: (a, b) => titleSortKey(a.title).localeCompare(titleSortKey(b.title)),
            author: (a, b) => authorSortKey(a.author).localeCompare(authorSortKey(b.author))
                || titleSortKey(a.title).localeCompare(titleSortKey(b.title)),
            series: (a, b) => (a.series ? 0 : 1) - (b.series ? 0 : 1)
                || (a.series?.name ?? '').localeCompare(b.series?.name ?? '')
                || (a.series?.position ?? 0) - (b.series?.position ?? 0)
                || titleSortKey(a.title).localeCompare(titleSortKey(b.title)),
        }[settings.libSort] ?? (() => 0)
        return [...list].sort(by)
    }

    #sortMenu(anchor) {
        showMenu(anchor, [
            { heading: 'Sort by' },
            ...SORTS.map(([id, label]) => ({
                label, checked: settings.libSort === id,
                onClick: () => { settings.set({ libSort: id }); this.render() },
            })),
        ])
    }

    // ---------- rendering
    #coverURL(book) {
        if (!book.cover) return null
        if (!this.#coverURLs.has(book.id)) this.#coverURLs.set(book.id, URL.createObjectURL(book.cover))
        return this.#coverURLs.get(book.id)
    }
    #cover(book) {
        const url = this.#coverURL(book)
        if (url) return h('div', { class: 'cover' }, h('img', { src: url, alt: '', loading: 'lazy', draggable: 'false' }))
        // generated cover, like a dedicated e-reader does for books without one
        return h('div', { class: 'cover cover-generated' },
            h('div', { class: 'gc-title' }, book.title),
            h('div', { class: 'gc-rule' }),
            h('div', { class: 'gc-author' }, book.author || ''))
    }
    #status(book) {
        if (book.finished) return h('span', { class: 'badge badge-done' }, 'Finished')
        if (!book.progress && !book.lastOpenedAt) return h('span', { class: 'badge badge-new' }, 'New')
        return h('span', { class: 'progress-text' }, percent(book.progress))
    }
    #bookItem(book) {
        const isList = settings.libView === 'list'
        const moreBtn = h('button', {
            class: 'icon-btn book-more', title: 'More', 'aria-label': `More options for ${book.title}`,
            html: icon('more'),
            onclick: e => { e.stopPropagation(); this.#bookMenu(book, e.currentTarget) },
        })
        const progress = h('div', { class: 'book-progress', 'aria-hidden': 'true' },
            h('div', { style: { width: percent(book.finished ? 1 : book.progress) } }))
        const item = h('div', {
            class: 'book', role: 'listitem', tabindex: '0',
            title: `${book.title}${book.author ? ` by ${book.author}` : ''}`,
            onclick: () => this.onOpen(book.id),
            onkeydown: e => {
                if (e.key === 'Enter') this.onOpen(book.id)
                if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                    e.preventDefault()
                    this.#bookMenu(book, item)
                }
            },
            oncontextmenu: e => { e.preventDefault(); this.#bookMenu(book, { x: e.clientX, y: e.clientY }) },
        },
        h('div', { class: 'book-cover-wrap' }, this.#cover(book), book.progress > 0 && !book.finished ? progress : null),
        h('div', { class: 'book-info' },
            h('div', { class: 'book-title' }, book.title),
            h('div', { class: 'book-author' }, book.author || 'Unknown author'),
            isList && book.series ? h('div', { class: 'book-series' },
                `${book.series.name}${book.series.position != null ? ` · Book ${book.series.position}` : ''}`) : null,
            h('div', { class: 'book-meta' }, this.#status(book), isList ? h('span', { class: 'muted' }, ` · ${book.format}`) : null)),
        moreBtn)
        // long-press for touch devices
        let timer
        item.addEventListener('touchstart', e => {
            timer = setTimeout(() => {
                timer = null
                const t = e.touches[0]
                this.#bookMenu(book, { x: t.clientX, y: t.clientY })
            }, 550)
        }, { passive: true })
        const cancel = () => clearTimeout(timer)
        item.addEventListener('touchend', e => { if (timer === null) e.preventDefault(); cancel() })
        item.addEventListener('touchmove', cancel, { passive: true })
        return item
    }

    #renderTabs() {
        const tabs = $('#lib-tabs')
        tabs.replaceChildren(...TABS.map(([id, label]) => h('button', {
            class: `tab${settings.libFilter === id && !this.collection ? ' active' : ''}${id === 'collections' && this.collection ? ' active' : ''}`,
            'aria-pressed': String(settings.libFilter === id),
            onclick: () => {
                this.collection = null
                settings.set({ libFilter: id })
                this.render()
            },
        }, label, id !== 'collections' ? h('span', { class: 'tab-count' }, this.#count(id)) : null)))
    }
    #count(id) {
        const b = this.books
        if (id === 'all') return b.length
        if (id === 'reading') return b.filter(x => !x.finished && (x.progress > 0 || x.lastOpenedAt)).length
        if (id === 'unread') return b.filter(x => !x.finished && !x.progress && !x.lastOpenedAt).length
        if (id === 'finished') return b.filter(x => x.finished).length
        return ''
    }

    #renderCollections() {
        const names = this.collectionNames
        const tiles = names.map(name => {
            const books = this.books.filter(b => b.collections?.includes(name))
            const covers = books.slice(0, 3)
            const tile = h('div', {
                class: 'collection', role: 'listitem', tabindex: '0',
                onclick: () => { this.collection = name; this.render() },
                onkeydown: e => { if (e.key === 'Enter') { this.collection = name; this.render() } },
            },
            h('div', { class: 'collection-stack' },
                covers.length ? covers.map(b => this.#cover(b)) : h('div', { class: 'collection-empty', html: icon('folder') })),
            h('div', { class: 'book-info' },
                h('div', { class: 'book-title' }, name),
                h('div', { class: 'book-author' }, `${books.length} book${books.length === 1 ? '' : 's'}`)),
            h('button', {
                class: 'icon-btn book-more', 'aria-label': `More options for ${name}`, html: icon('more'),
                onclick: e => {
                    e.stopPropagation()
                    showMenu(e.currentTarget, [
                        { label: 'Rename', onClick: () => this.#renameCollection(name) },
                        { label: 'Delete collection', danger: true, onClick: () => this.#deleteCollection(name) },
                    ])
                },
            }))
            return tile
        })
        const add = h('div', {
            class: 'collection collection-new', role: 'listitem', tabindex: '0',
            onclick: async () => { if (await this.#newCollection()) this.render() },
        }, h('div', { class: 'collection-stack' }, h('div', { class: 'collection-empty', html: icon('plus') })),
        h('div', { class: 'book-info' }, h('div', { class: 'book-title' }, 'New collection')))
        this.grid.replaceChildren(...tiles, add)
    }

    render() {
        this.#renderTabs()
        $('#btn-view-mode').innerHTML = icon(settings.libView === 'grid' ? 'list' : 'grid')
        $('#btn-view-mode').title = settings.libView === 'grid' ? 'List view' : 'Grid view'
        this.grid.className = `book-grid ${settings.libView}`

        const bar = $('#lib-collection-bar')
        bar.hidden = !this.collection
        if (this.collection) bar.replaceChildren(
            h('button', { class: 'icon-btn', 'aria-label': 'Back to collections', html: icon('back'),
                onclick: () => { this.collection = null; settings.set({ libFilter: 'collections' }); this.render() } }),
            h('h2', {}, this.collection),
            h('button', { class: 'icon-btn', 'aria-label': 'Collection options', html: icon('more'),
                onclick: e => showMenu(e.currentTarget, [
                    { label: 'Rename', onClick: () => this.#renameCollection(this.collection) },
                    { label: 'Delete collection', danger: true, onClick: () => this.#deleteCollection(this.collection) },
                ]) }))

        const empty = this.books.length === 0
        $('#lib-empty').hidden = !empty
        if (empty) {
            this.grid.replaceChildren()
            $('#lib-noresults').hidden = true
            return
        }
        if (settings.libFilter === 'collections' && !this.collection && !this.query) {
            $('#lib-noresults').hidden = true
            this.#renderCollections()
            return
        }
        const list = this.#visibleBooks()
        $('#lib-noresults').hidden = list.length > 0
        $('#lib-noresults').querySelector('p').textContent = this.collection && !this.query
            ? 'This collection is empty. Add books from their “⋯” menu.' : 'No books match.'
        this.grid.replaceChildren(...list.map(b => this.#bookItem(b)))
    }

    // called by the reader when progress changes
    patchBook(id, patch) {
        const b = this.books.find(b => b.id === id)
        if (b) Object.assign(b, patch)
    }
}
