// Turns a dropped/picked file into a library record.
import { makeBook } from '../vendor/foliate-js/view.js'
import { langMap, formatContributor } from './util.js'

export const SUPPORTED_EXT = ['epub', 'mobi', 'azw3', 'azw', 'kf8', 'prc', 'fb2', 'fbz', 'cbz']

export const extOf = name => {
    const n = String(name ?? '').toLowerCase()
    if (n.endsWith('.fb2.zip')) return 'fbz'
    return n.includes('.') ? n.split('.').pop() : ''
}

export const isSupported = file => SUPPORTED_EXT.includes(extOf(file.name))

export class DRMError extends Error {}

const FORMAT_LABEL = {
    epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', azw: 'AZW', kf8: 'KF8', prc: 'MOBI',
    fb2: 'FB2', fbz: 'FB2', cbz: 'CBZ',
}

const MIME = {
    epub: 'application/epub+zip',
    cbz: 'application/vnd.comicbook+zip',
    fb2: 'application/x-fictionbook+xml',
    fbz: 'application/x-zip-compressed-fb2',
}

// Re-wrap a stored Blob as a File: foliate-js sniffs some formats by file name.
export const asFile = (blob, record) =>
    blob instanceof File ? blob
        : new File([blob], record.fileName, { type: MIME[extOf(record.fileName)] ?? blob.type ?? '' })

const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')

// Stable ID so re-adding the same file doesn't create a duplicate.
const fileId = async file => {
    try {
        if (crypto?.subtle) return hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())).slice(0, 32)
    } catch { /* fall through */ }
    // FNV-1a over the first 4 MB + size (non-secure contexts)
    const buf = new Uint8Array(await file.slice(0, 4 * 1024 * 1024).arrayBuffer())
    let h1 = 0x811c9dc5
    for (const b of buf) h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0
    return `${h1.toString(16)}-${file.size.toString(16)}`
}

// ---- DRM detection: give a clear message instead of a blank page
const checkMobiDRM = async file => {
    const head = new DataView(await file.slice(0, 86).arrayBuffer())
    if (head.byteLength < 86) return
    const rec0 = head.getUint32(78)
    const pd = new DataView(await file.slice(rec0, rec0 + 16).arrayBuffer())
    if (pd.byteLength >= 14 && pd.getUint16(12) !== 0) throw new DRMError('DRM-protected')
}

const FONT_OBFUSCATION = [
    'http://www.idpf.org/2008/embedding',
    'http://ns.adobe.com/pdf/enc#RC',
]
const checkEpubDRM = async file => {
    const { configure, ZipReader, BlobReader, TextWriter } = await import('../vendor/foliate-js/vendor/zip.js')
    configure({ useWebWorkers: false })
    const reader = new ZipReader(new BlobReader(file))
    try {
        const entries = await reader.getEntries()
        const names = new Set(entries.map(e => e.filename))
        if (names.has('META-INF/rights.xml')) throw new DRMError('DRM-protected')
        const enc = entries.find(e => e.filename === 'META-INF/encryption.xml')
        if (enc) {
            const xml = await enc.getData(new TextWriter())
            const algos = Array.from(xml.matchAll(/Algorithm\s*=\s*["']([^"']+)["']/g), m => m[1])
                .filter(a => !/xmldsig|xmlenc#(rsa|kw)/.test(a))
            if (algos.some(a => !FONT_OBFUSCATION.includes(a))) throw new DRMError('DRM-protected')
        }
    } finally {
        await reader.close?.()
    }
}

export const checkDRM = async (file, ext = extOf(file.name)) => {
    if (['mobi', 'azw', 'azw3', 'kf8', 'prc'].includes(ext)) await checkMobiDRM(file)
    else if (ext === 'epub') await checkEpubDRM(file)
}

// Shrink covers so the library stays light.
const shrinkCover = async blob => {
    if (!blob) return null
    try {
        const bmp = await createImageBitmap(blob)
        const maxW = 360
        if (bmp.width <= maxW) { bmp.close?.(); return blob }
        const w = maxW, hgt = Math.round(bmp.height * (maxW / bmp.width))
        const canvas = new OffscreenCanvas(w, hgt)
        canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt)
        bmp.close?.()
        return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    } catch {
        return blob
    }
}

const seriesOf = metadata => {
    const s = metadata?.belongsTo?.series
    const one = Array.isArray(s) ? s[0] : s
    const name = langMap(one?.name)
    if (!name) return null
    const pos = parseFloat(one?.position)
    return { name, position: Number.isFinite(pos) ? pos : null }
}

const fileNameTitle = name => String(name).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()

export const importFile = async file => {
    const ext = extOf(file.name)
    if (!SUPPORTED_EXT.includes(ext)) throw new Error(`Unsupported file type: .${ext || '?'}`)
    await checkDRM(file, ext)
    const id = await fileId(file)
    const book = await makeBook(file)
    try {
        const md = book.metadata ?? {}
        let cover = null
        try { cover = await shrinkCover(await book.getCover?.()) } catch { /* no cover */ }
        return {
            record: {
                id,
                title: (langMap(md.title) || '').trim() && langMap(md.title) !== file.name
                    ? langMap(md.title).trim() : fileNameTitle(file.name),
                author: formatContributor(md.author),
                series: seriesOf(md),
                language: Array.isArray(md.language) ? md.language[0] : md.language ?? '',
                publisher: formatContributor(md.publisher),
                published: md.published ?? '',
                description: langMap(md.description) ?? '',
                format: FORMAT_LABEL[ext] ?? ext.toUpperCase(),
                fileName: file.name,
                size: file.size,
                addedAt: Date.now(),
                lastOpenedAt: 0,
                progress: 0,
                cfi: null,
                finished: false,
                collections: [],
                cover,
            },
            blob: file,
        }
    } finally {
        try { book.destroy?.() } catch { /* ignore */ }
    }
}
