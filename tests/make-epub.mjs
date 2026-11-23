// Builds a small valid EPUB 3 in memory (no dependencies) for tests.
import { deflateRawSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
})
const crc32 = buf => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

const zip = entries => {
    const locals = [], centrals = []
    let offset = 0
    for (const { name, data, store } of entries) {
        const nameBuf = Buffer.from(name)
        const raw = Buffer.from(data)
        const body = store ? raw : deflateRawSync(raw)
        const crc = crc32(raw)
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6)
        local.writeUInt16LE(store ? 0 : 8, 8); local.writeUInt32LE(0, 10)
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22)
        local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
        const central = Buffer.alloc(46)
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
        central.writeUInt16LE(0, 8); central.writeUInt16LE(store ? 0 : 8, 10); central.writeUInt32LE(0, 12)
        central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24)
        central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
        locals.push(local, nameBuf, body)
        centrals.push(central, nameBuf)
        offset += 30 + nameBuf.length + body.length
    }
    const cd = Buffer.concat(centrals)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
    return Buffer.concat([...locals, cd, end])
}

const para = (i, j) => `<p>This is paragraph ${j + 1} of chapter ${i + 1}. The quick brown fox jumps over the lazy dog, and the reader turns the page to see what happens next. ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(3)}</p>`

// `evilScript`: embed a <script> in chapter 1, to check that book scripts are blocked
export const makeTestEpub = async ({ title = 'A Test Book', author = 'Test Author', chapters = 4, evilScript = true } = {}) => {
    const chs = Array.from({ length: chapters }, (_, i) => ({
        id: `ch${i + 1}`,
        title: `Chapter ${i + 1}`,
        html: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>Chapter ${i + 1}</title></head>
<body>${evilScript && i === 0 ? '<script>try { parent.parent.document.title = "PWNED" } catch (e) {} document.title = "PWNED"; window.top.__pwned = true</script>' : ''}<section><h1>Chapter ${i + 1}</h1>${Array.from({ length: 30 }, (_, j) => para(i, j)).join('\n')}</section></body></html>`,
    }))
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:5b1e1c8e-0000-4000-8000-${title.length.toString().padStart(12, '0')}</dc:identifier>
<dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language>
<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${chs.map(c => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine>${chs.map(c => `<itemref idref="${c.id}"/>`).join('')}</spine>
</package>`
    const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>${chs.map(c => `<li><a href="${c.id}.xhtml">${c.title}</a></li>`).join('')}</ol></nav></body></html>`
    return zip([
        { name: 'mimetype', data: 'application/epub+zip', store: true },
        { name: 'META-INF/container.xml', data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
        { name: 'OEBPS/content.opf', data: opf },
        { name: 'OEBPS/nav.xhtml', data: nav },
        ...chs.map(c => ({ name: `OEBPS/${c.id}.xhtml`, data: c.html })),
    ])
}
