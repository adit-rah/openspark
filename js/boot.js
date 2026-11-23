// Runs before the first paint (a classic, render-blocking script) so opening the
// app at night never flashes the light theme. light.js leaves a hint in
// localStorage: the day and night colors and the upcoming night windows.
(function () {
    try {
        var hint = JSON.parse(localStorage.getItem('openspark:boot') || 'null')
        var now = Date.now()
        var night
        if (!hint) {
            // first launch: assume the evening is night
            var hr = new Date().getHours()
            night = hr >= 20 || hr < 7
            hint = { day: { dark: false, bg: '#f4f1ea', fg: '#1b1b1b', ui: '#f4f1ea' },
                night: { dark: true, bg: '#000000', fg: '#8a6a4e', ui: '#0b0908' } }
        } else if (hint.mode === 'on') night = true
        else if (hint.mode === 'off') night = false
        else if (hint.mode === 'system') night = matchMedia('(prefers-color-scheme: dark)').matches
        else night = (hint.windows || []).some(function (w) {
            return w === 'always' || (w !== 'never' && now >= w[0] && now < w[1])
        })
        var look = night ? hint.night : hint.day
        var root = document.documentElement
        root.dataset.theme = look.dark ? 'dark' : 'light'
        root.style.background = look.ui
        root.style.setProperty('--page-bg', look.bg)
        root.style.setProperty('--page-fg', look.fg)
        var meta = document.querySelector('meta[name="theme-color"]')
        if (meta) meta.setAttribute('content', look.ui)
    } catch (e) { /* storage unavailable: use the stylesheet defaults */ }
})()
