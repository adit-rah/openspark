export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

// Tiny element builder: h('div', { class: 'x', onclick }, child, 'text')
export const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs ?? {})) {
        if (v == null || v === false) continue
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
        else if (k === 'class') el.className = v
        else if (k === 'html') el.innerHTML = v
        else if (k === 'dataset') Object.assign(el.dataset, v)
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
        else if (v === true) el.setAttribute(k, '')
        else el.setAttribute(k, v)
    }
    for (const c of children.flat()) {
        if (c == null || c === false) continue
        el.append(c instanceof Node ? c : document.createTextNode(String(c)))
    }
    return el
}

export const debounce = (f, ms) => {
    let t
    const wrapped = (...args) => {
        clearTimeout(t)
        t = setTimeout(() => f(...args), ms)
    }
    wrapped.flush = (...args) => { clearTimeout(t); f(...args) }
    return wrapped
}

// ---- metadata formatting (foliate-js metadata can be strings, language maps, objects or arrays)
export const langMap = x => {
    if (!x) return ''
    if (typeof x === 'string') return x
    const keys = Object.keys(x)
    return x[keys[0]] ?? ''
}
const oneContributor = c => typeof c === 'string' ? c : langMap(c?.name)
export const formatContributor = c => {
    if (!c) return ''
    const list = (Array.isArray(c) ? c : [c]).map(oneContributor).filter(Boolean)
    try {
        return new Intl.ListFormat('en', { style: 'short', type: 'conjunction' }).format(list)
    } catch {
        return list.join(', ')
    }
}

// "Jane Austen" -> "Austen, Jane" for sorting by author's last name
export const authorSortKey = author => {
    const first = String(author ?? '').split(/,| and | & /)[0].trim()
    if (!first) return '￿'
    if (first.includes(',')) return first.toLowerCase()
    const parts = first.split(/\s+/)
    const last = parts.pop()
    return `${last} ${parts.join(' ')}`.toLowerCase()
}

// ignore leading articles when sorting titles, like most e-readers do
export const titleSortKey = title => String(title ?? '')
    .toLowerCase().replace(/^(the|a|an)\s+/, '').trim() || '￿'

export const formatBytes = n => {
    if (!n) return '0 B'
    const u = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

export const formatDate = ts => ts
    ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : ''

export const formatMinutes = mins => {
    mins = Math.max(1, Math.round(mins))
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'}`
    const hrs = Math.floor(mins / 60), m = mins % 60
    return `${hrs} hr${hrs === 1 ? '' : 's'}${m ? ` ${m} min${m === 1 ? '' : 's'}` : ''}`
}

export const percent = f => `${Math.round(Math.max(0, Math.min(1, f || 0)) * 100)}%`

export const storage = {
    get(key, fallback) {
        try {
            const v = localStorage.getItem(key)
            return v == null ? fallback : JSON.parse(v)
        } catch {
            return fallback
        }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode etc. */ }
    },
}

let toastTimer
export const toast = (msg, ms = 2600) => {
    const el = document.getElementById('toast')
    el.textContent = msg
    el.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.hidden = true, ms)
}

export const downloadText = (name, text) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = h('a', { href: url, download: name })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Generic popup menu anchored to an element or point.
// items: [{ label, onClick, checked, danger, separator, disabled }]
export const showMenu = (anchor, items, { align = 'right' } = {}) => {
    const layer = document.getElementById('menu-layer')
    layer.replaceChildren()
    const close = () => {
        layer.replaceChildren()
        document.removeEventListener('pointerdown', onDown, true)
        document.removeEventListener('keydown', onKey, true)
    }
    const onDown = e => { if (!menu.contains(e.target)) close() }
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    const menu = h('div', { class: 'menu', role: 'menu' },
        items.map(item => item.separator ? h('div', { class: 'menu-sep' })
            : item.heading ? h('div', { class: 'menu-heading' }, item.heading)
            : h('button', {
                class: `menu-item${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}`,
                role: item.checked != null ? 'menuitemradio' : 'menuitem',
                'aria-checked': item.checked != null ? String(!!item.checked) : null,
                disabled: item.disabled,
                onclick: () => { close(); item.onClick?.() },
            }, h('span', { class: 'menu-check' }), h('span', {}, item.label))))
    layer.append(menu)
    const r = anchor instanceof Element ? anchor.getBoundingClientRect()
        : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }
    const mw = menu.offsetWidth, mh = menu.offsetHeight
    let x = align === 'right' ? r.right - mw : r.left
    let y = r.bottom + 4
    if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4)
    x = Math.max(8, Math.min(innerWidth - mw - 8, x))
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
    setTimeout(() => {
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey, true)
    })
    menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true })
    return close
}

// Simple modal dialogs (prompt / confirm / custom content)
export const modal = ({ title, body, actions = [], onClose }) => {
    const layer = document.getElementById('modal-layer')
    const close = value => {
        wrap.remove()
        document.removeEventListener('keydown', onKey, true)
        onClose?.(value)
    }
    const onKey = e => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null) }
    }
    const wrap = h('div', { class: 'modal-wrap', onclick: e => { if (e.target === wrap) close(null) } },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
            title ? h('h2', { class: 'modal-title' }, title) : null,
            h('div', { class: 'modal-body' }, body),
            actions.length ? h('div', { class: 'modal-actions' }, actions.map(a =>
                h('button', {
                    class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`,
                    onclick: () => close(a.value ?? a.label),
                }, a.label))) : null))
    layer.append(wrap)
    document.addEventListener('keydown', onKey, true)
    setTimeout(() => (wrap.querySelector('input, textarea') ?? wrap.querySelector('.btn-primary'))?.focus())
    return close
}

export const promptText = (title, { value = '', placeholder = '', ok = 'Save', multiline = false } = {}) =>
    new Promise(resolve => {
        const input = multiline
            ? h('textarea', { class: 'text-input', rows: 5, placeholder })
            : h('input', { class: 'text-input', type: 'text', placeholder })
        input.value = value
        let close
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                close('ok')
            }
        })
        close = modal({
            title, body: input,
            actions: [{ label: 'Cancel', value: null }, { label: ok, value: 'ok', primary: true }],
            onClose: v => resolve(v === 'ok' ? input.value : null),
        })
    })

export const confirmDialog = (title, message, { ok = 'OK', danger = false } = {}) =>
    new Promise(resolve => modal({
        title, body: h('p', {}, message),
        actions: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !danger, danger }],
        onClose: v => resolve(v === true),
    }))
