// IndexedDB storage. Everything stays in the browser on this device.
//
//   books        metadata, cover and reading progress (small; loaded for the library)
//   files        the original book file as a Blob (large; loaded only when reading)
//   annotations  bookmarks and highlights, indexed by bookId

const DB_NAME = 'openspark'
const DB_VERSION = 1

let dbPromise
const open = () => dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('annotations')) {
            const s = db.createObjectStore('annotations', { keyPath: 'id' })
            s.createIndex('bookId', 'bookId')
        }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
})

const tx = async (stores, mode, fn) => {
    const db = await open()
    return new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode)
        let result
        Promise.resolve(fn(...[stores].flat().map(s => t.objectStore(s))))
            .then(r => result = r, reject)
        t.oncomplete = () => resolve(result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
    })
}

const req = r => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
})

export const db = {
    getBooks: () => tx('books', 'readonly', s => req(s.getAll())),
    getBook: id => tx('books', 'readonly', s => req(s.get(id))),
    putBook: book => tx('books', 'readwrite', s => req(s.put(book))),
    async updateBook(id, patch) {
        return tx('books', 'readwrite', async s => {
            const book = await req(s.get(id))
            if (!book) return null
            Object.assign(book, typeof patch === 'function' ? patch(book) : patch)
            await req(s.put(book))
            return book
        })
    },
    addBook: (book, blob) => tx(['books', 'files'], 'readwrite', (books, files) => {
        books.put(book)
        files.put({ id: book.id, blob })
    }),
    getFile: id => tx('files', 'readonly', s => req(s.get(id))).then(r => r?.blob ?? null),
    deleteBook: id => tx(['books', 'files', 'annotations'], 'readwrite', async (books, files, ann) => {
        books.delete(id)
        files.delete(id)
        const keys = await req(ann.index('bookId').getAllKeys(id))
        for (const k of keys) ann.delete(k)
    }),
    getAnnotations: bookId => tx('annotations', 'readonly', s => req(s.index('bookId').getAll(bookId))),
    putAnnotation: a => tx('annotations', 'readwrite', s => req(s.put(a))),
    deleteAnnotation: id => tx('annotations', 'readwrite', s => req(s.delete(id))),
}

// Ask the browser not to evict our data under storage pressure.
export const requestPersistence = async () => {
    try {
        if (navigator.storage?.persisted && !(await navigator.storage.persisted()))
            await navigator.storage.persist?.()
    } catch { /* not supported */ }
}
