// Small hand-drawn stroke icons (24×24). Kept inline so the app works offline
// with no icon font.
const svg = (body, { fill = false } = {}) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" ` +
    `fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const icons = {
    back: svg('<path d="M15 5l-7 7 7 7"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>'),
    list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9" fill="currentColor"/><circle cx="4.5" cy="12" r=".9" fill="currentColor"/><circle cx="4.5" cy="18" r=".9" fill="currentColor"/>'),
    sort: svg('<path d="M4 7h16M7 12h10M10 17h4"/>'),
    more: svg('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
    aa: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><text x="1.5" y="18.5" font-family="Georgia, serif" font-size="16" fill="currentColor">A</text><text x="12.5" y="18.5" font-family="Georgia, serif" font-size="11" fill="currentColor">a</text></svg>`,
    goto: svg('<path d="M4 6h16M4 12h10M4 18h13"/>'),
    notebook: svg('<path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 17 20.5H6z"/><path d="M6 3.5v17M9.5 8h5.5M9.5 11.5h5.5"/>'),
    bookmark: svg('<path d="M7 3.5h10v17l-5-4-5 4z"/>'),
    bookmarkFilled: svg('<path d="M7 3.5h10v17l-5-4-5 4z"/>', { fill: true }),
    highlight: svg('<path d="M4 20h7"/><path d="M14.5 4.5l5 5-8 8H6.5v-5z"/>'),
    note: svg('<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 5.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h.5"/>'),
    trash: svg('<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 13h9l1-13M9.5 7V4.5h5V7"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    download: svg('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
    book: svg('<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z"/><path d="M12 6.5v13"/>'),
    folder: svg('<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>'),
    chevron: svg('<path d="M9 6l6 6-6 6"/>'),
    chevronDown: svg('<path d="M6 9l6 6 6-6"/>'),
    info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>'),
}

export const icon = name => icons[name] ?? ''

// Fill every element that has a data-icon attribute.
export const hydrateIcons = (root = document) => {
    for (const el of root.querySelectorAll('[data-icon]'))
        el.innerHTML = icon(el.dataset.icon)
}
