import { Library } from './library.js'
import { Reader } from './reader.js'
import { db, requestPersistence } from './db.js'
import { fontFaceCSS, settings } from './settings.js'
import { hydrateIcons } from './icons.js'
import { $, toast, modal, h } from './util.js'

// fonts for the app UI (book pages get their own copy)
document.head.append(Object.assign(document.createElement('style'), { textContent: fontFaceCSS() }))
hydrateIcons()

// the app UI follows the reading theme: dark when reading in dark, paper otherwise
const applyUITheme = () => {
    document.documentElement.dataset.theme = settings.theme === 'dark' ? 'dark' : 'light'
}
applyUITheme()
settings.onChange(p => { if ('theme' in p) applyUITheme() })

const library = new Library({ onOpen: id => { location.hash = `#/read/${encodeURIComponent(id)}` } })
const reader = new Reader({
    onClose: () => {
        if (history.state?.fromLibrary) history.back()
        else location.hash = '#/'
    },
    onProgress: (id, patch) => library.patchBook(id, patch),
})

const show = name => {
    $('#library').hidden = name !== 'library'
    $('#reader').hidden = name !== 'reader'
    document.body.dataset.view = name
}

let opening = null
const route = async () => {
    const m = location.hash.match(/^#\/read\/(.+)$/)
    if (m) {
        const id = decodeURIComponent(m[1])
        if (reader.record?.id === id) return show('reader')
        await reader.close()
        const record = await db.getBook(id)
        if (!record) {
            toast('That book is no longer in your library')
            location.replace('#/')
            return
        }
        show('reader')
        const token = opening = Symbol()
        try {
            await reader.open(record)
        } catch (e) {
            if (token !== opening) return
            console.error(e)
            await reader.close()
            show('library')
            history.replaceState(null, '', '#/')
            modal({
                title: 'Could not open this book',
                body: h('p', {}, `${e?.message || 'The file could not be read.'} If it was bought from an online store it may be DRM-protected; only DRM-free files can be opened.`),
                actions: [{ label: 'OK', primary: true }],
            })
        }
    } else {
        if (reader.record) await reader.close()
        show('library')
        document.querySelector('meta[name="theme-color"]')
            ?.setAttribute('content', settings.getTheme().id === 'dark' ? '#111111' : '#f4f1ea')
        library.render()
    }
}

// remember that the reader was entered from the library so "back" pops history
addEventListener('hashchange', e => {
    if (location.hash.startsWith('#/read/') && !(new URL(e.oldURL).hash.startsWith('#/read/')))
        history.replaceState({ fromLibrary: true }, '')
    route()
})

// Open files handed to the installed app by the OS ("Open with…")
if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
        const files = await Promise.all((params.files ?? []).map(f => f.getFile()))
        if (files.length) {
            location.hash = '#/'
            await library.addFiles(files)
        }
    })
}

await library.load()
route()
requestPersistence()

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/[?&]nosw\b/.test(location.search)) {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service worker not registered', e))
}

// for debugging from the console
globalThis.openspark = { library, reader, settings, db }
