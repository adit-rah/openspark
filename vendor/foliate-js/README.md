# Vendored: foliate-js

The e-book parsing and pagination engine used by OpenSpark.

- Upstream: https://github.com/johnfactotum/foliate-js
- Commit: `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01)
- License: MIT (see `LICENSE`). Bundled `vendor/zip.js` is BSD-3-Clause, `vendor/fflate.js` is MIT.

Only the modules OpenSpark uses are copied, unmodified. PDF, TTS, OPDS and
dictionary modules are left out.

To update, copy the same files from a newer upstream checkout:

```sh
git clone --depth 1 https://github.com/johnfactotum/foliate-js /tmp/foliate-js
for f in view.js epub.js epubcfi.js mobi.js fb2.js comic-book.js fixed-layout.js \
         paginator.js progress.js overlayer.js text-walker.js search.js LICENSE; do
  cp /tmp/foliate-js/$f vendor/foliate-js/
done
cp /tmp/foliate-js/vendor/zip.js /tmp/foliate-js/vendor/fflate.js vendor/foliate-js/vendor/
```

Upstream warns that its API is not stable, so run `npm test` after updating.
