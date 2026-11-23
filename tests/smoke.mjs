// End-to-end smoke test: imports a book, opens it, turns pages, uses the panels.
// Usage: node serve.mjs 8080 & node tests/smoke.mjs [book.epub ...]
// With no arguments it builds a tiny EPUB on the fly.
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTestEpub } from './make-epub.mjs'

// use the project's playwright if installed, else a globally installed one
const { chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'))

const BASE = process.env.BASE_URL ?? 'http://localhost:8080/'
const SHOTS = process.env.SHOTS // directory for screenshots, optional

let files = process.argv.slice(2)
if (!files.length) {
    const dir = await mkdtemp(join(tmpdir(), 'openspark-'))
    const path = join(dir, 'test-book.epub')
    await writeFile(path, await makeTestEpub())
    files = [path]
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

const shot = async name => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) })
const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`) }

await page.goto(BASE + '?nosw')
await page.waitForFunction(() => globalThis.openspark)
// tests run in daylight mode, whatever the time is where they run
await page.evaluate(() => openspark.settings.set({ nightMode: 'off' }))
await page.waitForSelector('#lib-empty:not([hidden])')
await shot('01-empty')

await page.setInputFiles('#file-input', files)
await page.waitForFunction(n => document.querySelectorAll('#lib-grid .book').length === n, files.length, { timeout: 60000 })
await page.waitForTimeout(300)
await shot('02-library')

await page.click('#lib-grid .book')
await page.waitForSelector('#reader:not([hidden])')
await page.waitForSelector('#reader-loading[hidden]', { state: 'attached', timeout: 60000 })
await page.waitForFunction(() => document.querySelector('#status-right').textContent.includes('%'), null, { timeout: 30000 })
await page.waitForTimeout(500)
await shot('03-reader')

const pwned = await page.evaluate(() => window.__pwned === true || document.title === 'PWNED')
assert(!pwned, 'scripts inside books must not run')

const before = await page.textContent('#status-right')
for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150) }
await page.waitForTimeout(300)
const loc = await page.evaluate(() => openspark.reader.location?.fraction)
assert(loc > 0, `page turns advance (fraction ${loc}, before ${before})`)

// tap the top of the page to show the toolbar
const box = await page.locator('#screen').boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + 20)
await page.waitForSelector('#reader-top:not([hidden])')
await shot('04-toolbar')

await page.click('#btn-aa')
await page.waitForSelector('#panel-aa:not([hidden])')
await shot('05-aa')
await page.click('.aa-tab:nth-child(3)')
await page.click('.theme-choice:nth-child(3)')
await page.waitForTimeout(300)
await page.keyboard.press('Escape')

await page.mouse.click(box.x + box.width / 2, box.y + 20)
await page.click('#btn-goto')
await page.waitForSelector('#panel-goto:not([hidden])')
await shot('06-goto')
const tocCount = await page.locator('.toc-item').count()
assert(tocCount > 0, 'table of contents has entries')
await page.locator('.toc-item').nth(Math.min(2, tocCount - 1)).click()
await page.waitForTimeout(500)

await page.keyboard.press('b')
await page.waitForSelector('#bookmark-ribbon:not([hidden])')
await shot('07-bookmark')

await page.keyboard.press('/')
await page.waitForSelector('#panel-search:not([hidden])')
await page.fill('#panel-search input', 'the')
await page.keyboard.press('Enter')
await page.waitForFunction(() => /result/.test(document.querySelector('.search-status')?.textContent), null, { timeout: 60000 })
await shot('08-search')
await page.keyboard.press('Escape')

// front light: warmth tints the page and is wired into images through #os-light
await page.keyboard.press('l')
await page.waitForSelector('#panel-light:not([hidden])')
await page.evaluate(() => openspark.settings.set({ nightMode: 'off', warmth: 20, brightness: 18 }))
await page.waitForTimeout(300)
await shot('08b-light')
const lit = await page.evaluate(() => {
    const { doc } = openspark.reader.view.renderer.getContents()[0]
    const [r, g, b] = getComputedStyle(doc.documentElement).backgroundColor.match(/\d+/g).map(Number)
    return { warm: r > g && g > b, matrix: !!doc.querySelector('#os-light feColorMatrix[values]') }
})
assert(lit.warm && lit.matrix, `warm light tints the page (${JSON.stringify(lit)})`)
await page.evaluate(() => openspark.settings.set({ nightMode: 'auto', warmth: 0, brightness: 24 }))
await page.keyboard.press('Escape')

await page.keyboard.press('Escape') // back to library
await page.waitForSelector('#library:not([hidden])')
await page.waitForTimeout(300)
await shot('09-library-after')
const prog = await page.textContent('#lib-grid .book .book-meta')
assert(/%|Finished/.test(prog), `library shows progress (${prog})`)

await browser.close()
// the CSP refusing the test book's script is the expected outcome
const real = errors.filter(e => !/favicon|ERR_FILE_NOT_FOUND|Content Security Policy/.test(e))
if (real.length) {
    console.error('Console errors:\n' + real.join('\n'))
    process.exit(1)
}
console.log('Smoke test passed')
