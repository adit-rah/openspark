// Offline support: cache the app shell so the reader works without a network.
// Books themselves live in IndexedDB, not in this cache.
const VERSION = 'openspark-v1'
const SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/app.css',
    './icons/icon.svg',
    './js/main.js',
    './js/library.js',
    './js/reader.js',
    './js/importer.js',
    './js/settings.js',
    './js/db.js',
    './js/util.js',
    './js/icons.js',
    './vendor/foliate-js/view.js',
    './vendor/foliate-js/epub.js',
    './vendor/foliate-js/epubcfi.js',
    './vendor/foliate-js/mobi.js',
    './vendor/foliate-js/fb2.js',
    './vendor/foliate-js/comic-book.js',
    './vendor/foliate-js/fixed-layout.js',
    './vendor/foliate-js/paginator.js',
    './vendor/foliate-js/progress.js',
    './vendor/foliate-js/overlayer.js',
    './vendor/foliate-js/text-walker.js',
    './vendor/foliate-js/search.js',
    './vendor/foliate-js/vendor/zip.js',
    './vendor/foliate-js/vendor/fflate.js',
    './fonts/literata-normal.woff2',
    './fonts/literata-italic.woff2',
    './fonts/literata-ext-normal.woff2',
    './fonts/literata-ext-italic.woff2',
    './fonts/atkinson-400-normal.woff2',
    './fonts/atkinson-400-italic.woff2',
    './fonts/atkinson-700-normal.woff2',
    './fonts/atkinson-700-italic.woff2',
]

self.addEventListener('install', e => {
    e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
        .then(() => self.clients.claim()))
})

// Network first (so updates arrive), falling back to the cache when offline.
self.addEventListener('fetch', e => {
    const { request } = e
    if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return
    e.respondWith(fetch(request)
        .then(res => {
            if (res.ok) {
                const copy = res.clone()
                caches.open(VERSION).then(c => c.put(request, copy))
            }
            return res
        })
        .catch(() => caches.match(request, { ignoreSearch: true })
            .then(r => r ?? (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))))
})
