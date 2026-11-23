# Contributing to OpenSpark

Thanks for helping. OpenSpark aims to stay small: a reader and a shelf, nothing else.

## Ground rules

- **No build step.** Plain ES modules, served as static files. Anyone should be able to
  open the code and change it without installing anything.
- **No network calls.** Books never leave the device. No analytics, no CDNs, no accounts.
- **No store, no sync service.** Features that need a server are out of scope.
- **E-ink first.** Prefer instant changes over animation, contrast over color, and
  flat hairline UI over shadows and gradients.
- **Original design.** The app takes inspiration from dedicated e-readers but must not
  copy anyone's trademarks, logos, proprietary fonts or artwork.

## Running locally

```sh
npm start            # http://localhost:8080
```

`localhost` counts as a secure context, which the app needs for Web Crypto (used for
book IDs and for de-obfuscating embedded EPUB fonts).

## Tests

```sh
npm install --no-save playwright && npx playwright install chromium
node serve.mjs 8080 &
npm test                         # builds a test EPUB on the fly
node tests/smoke.mjs my.epub     # or run against your own files
SHOTS=/tmp/shots npm test        # also save screenshots
```

## Code map

| Path | What it does |
| --- | --- |
| `js/main.js` | Boot, hash routing (`#/` library, `#/read/<id>` reader), service worker |
| `js/library.js` | Shelf: import, grid/list, sorting, filters, collections, book menu |
| `js/reader.js` | Reading view: tap zones, toolbar, status line, Aa/Go to/Search/Notebook panels, highlights, bookmarks |
| `js/importer.js` | Reads metadata and cover, DRM detection, stable book IDs |
| `js/settings.js` | Preferences and the CSS injected into book pages |
| `js/db.js` | IndexedDB storage |
| `vendor/foliate-js` | Parsing (EPUB, MOBI, AZW3, FB2, CBZ) and pagination; see its README |

## Ideas that fit

- Dictionary lookup from a user-supplied StarDict file (foliate-js has `dict.js`)
- Import/export of the library and annotations as a single backup file
- Better keyboard and screen-reader support
- Translations of the UI
