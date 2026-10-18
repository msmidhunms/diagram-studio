// Cloud service icons. The catalogue (../../shared/cloud_icons.json) is shared with the
// backend, which validates the `icon` field of each node against the same keys.
import catalogue from '../../shared/cloud_icons.json'

export const ICON_SLOT = 40 // px reserved at the left of a node that has an icon
const MAX_ICON_BYTES = 300_000

/** Catalogue entry for a node's icon key, with provider info, or null. */
export function iconInfo(key) {
  const entry = key && catalogue.icons[key]
  if (!entry) return null
  const provider = key.split(':')[0]
  const p = catalogue.providers[provider]
  // entry: label, img, drawio, drawio_color, puml
  return { ...entry, key, provider, providerName: p.name, providerColor: p.color, pumlLib: p.puml_lib, pumlCommon: p.puml_common }
}

const cache = new Map()

/** Fetch an icon SVG and return it as a data: URI, or null if it can't be loaded. Cached per URL. */
export function fetchIcon(url) {
  if (!url) return Promise.resolve(null)
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      try {
        const res = await fetch(url)
        const type = res.headers.get('content-type') || ''
        if (!res.ok || !type.includes('svg')) return null
        const text = await res.text()
        if (text.length > MAX_ICON_BYTES || !/<svg[\s>]/.test(text)) return null
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`
      } catch {
        return null // offline or blocked: callers fall back to a provider badge
      }
    })())
  }
  return cache.get(url)
}

/** Map of icon key -> data URI (or null) for every icon used in a model. */
export async function loadIcons(model, loader = fetchIcon) {
  const keys = [...new Set(model.nodes.map((n) => n.icon).filter((k) => iconInfo(k)))]
  const data = await Promise.all(keys.map((k) => loader(iconInfo(k).img)))
  return new Map(keys.map((k, i) => [k, data[i]]))
}
