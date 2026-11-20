export type UrlCheck = { ok: true; url: string; display: string } | { ok: false; error: string }

/** characters that can never appear in a link address: whitespace, control characters and the unsafe set from RFC 3986 */
const UNSAFE = new Set(['<', '>', '"', '`', String.fromCharCode(92), '^', '{', '}', '|'])
const isBad = (ch: string) => /\s/u.test(ch) || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || UNSAFE.has(ch)

const printable = (ch: string) => (ch === ' ' ? 'a space' : ch.charCodeAt(0) === 160 ? 'a non-breaking space' : `“${ch}”`)

function hostOk(host: string): string | null {
  if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[[0-9a-f:]+\]$/i.test(host)) return null
  const labels = host.split('.')
  if (labels.length < 2) return `“${host}” is not a complete web address (it needs something like .com or .ae at the end).`
  for (const l of labels) {
    if (!l) return 'The address has an empty part between dots.'
    if (l.length > 63) return 'A part of the address is longer than 63 characters.'
    if (!/^[a-z0-9-]+$/i.test(l) || l.startsWith('-') || l.endsWith('-')) return `“${l}” is not a valid part of a web address.`
  }
  const tld = labels[labels.length - 1]
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(tld)) return `“.${tld}” is not a valid ending for a web address.`
  return null
}

/**
 * Check a typed link address and put it in its final form:
 *  - no scheme → https:// is added (an e-mail address becomes mailto:)
 *  - only http(s), mailto: and tel: are allowed; whitespace and unsafe characters are rejected with the character named
 *  - the host must be a real-looking host name
 */
export function normalizeUrl(input: string): UrlCheck {
  const s = input.trim()
  if (!s || /^https?:\/\/?$/i.test(s)) return { ok: false, error: 'Enter the address the link should open.' }
  const bad = [...s].find(isBad)
  if (bad) return { ok: false, error: `The address contains ${printable(bad)}, which is not allowed in a link.` }

  const mail = /^mailto:(.*)$/i.exec(s)
  if (mail) {
    const addr = mail[1].split('?')[0]
    return /^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/i.test(addr) ? { ok: true, url: `mailto:${mail[1]}`, display: `mailto:${mail[1]}` } : { ok: false, error: 'This is not a valid e-mail address.' }
  }
  const tel = /^tel:(.*)$/i.exec(s)
  if (tel) return /^\+?[\d\-().]{3,}$/.test(tel[1]) && (tel[1].match(/\d/g) ?? []).length >= 3 ? { ok: true, url: `tel:${tel[1]}`, display: `tel:${tel[1]}` } : { ok: false, error: 'This is not a valid phone number.' }

  // "host:8080/path" has a colon but no scheme
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/:]+:\d+(\/|$)/.test(s)
  if (hasScheme && !/^https?:/i.test(s)) {
    const sch = /^([a-z][a-z0-9+.-]*):/i.exec(s)![1].toLowerCase()
    return { ok: false, error: `“${sch}:” links are not allowed. Use a web address (https://…), mailto: or tel:.` }
  }
  let withScheme = s
  if (/^\/\//.test(s)) withScheme = `https:${s}`
  else if (!hasScheme) {
    if (/^[^@\s/]+@[^@\s/]+\.[a-z]{2,}$/i.test(s)) return { ok: true, url: `mailto:${s}`, display: `mailto:${s}` }
    withScheme = `https://${s}`
  } else if (/^https?:\/\/(?!\/)/i.test(s) === false) return { ok: false, error: 'This is not a valid web address.' }

  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return { ok: false, error: 'This is not a valid web address.' }
  }
  if (u.username || u.password) return { ok: false, error: 'Addresses with a user name or password are not allowed.' }
  const why = hostOk(u.hostname)
  if (why) return { ok: false, error: why }
  let out = u.href
  if (u.pathname === '/' && !u.search && !u.hash && !/\/$/.test(withScheme)) out = out.replace(/\/$/, '') // keep "https://example.com" as typed
  return { ok: true, url: out, display: out.replace(/^https?:\/\//i, '') }
}
