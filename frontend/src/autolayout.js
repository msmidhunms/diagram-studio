// System model -> auto-laid-out SVG. ELK computes positions and orthogonal edge routes;
// this file only measures text and draws shapes, so no LLM is involved in layout.
import ELK from 'elkjs/lib/elk.bundled.js'
import { describeChanges } from './diff'
import { ICON_SLOT, fetchIcon, iconInfo, loadIcons } from './icons'

const elk = new ELK()
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const LABEL_PX = 7.4 // rough average glyph width at 13px semibold
const TECH_PX = 6.2 // at 11px
const WRAP = 24 // characters per label line
const LINE_H = 16

export const NODE_COLORS = {
  database: ['#e8f1fb', '#3b6ea5'],
  storage: ['#e8f1fb', '#3b6ea5'],
  cache: ['#fdf1e3', '#c07a2c'],
  queue: ['#f3ecfa', '#7d55a8'],
  client: ['#eaf6ee', '#3f8a57'],
  user: ['#eaf6ee', '#3f8a57'],
  external: ['#f4f4f4', '#777777'],
  gateway: ['#fff8db', '#a68a1f'],
  function: ['#eef7f7', '#2f8585'],
}
export const DEFAULT_COLORS = ['#ffffff', '#57606a']
export const GROUP_STYLES = {
  tier: { fill: '#f6f8fa', stroke: '#d0d7de', text: '#57606a' },
  trust_zone: { fill: '#fff7f6', stroke: '#c0392b', text: '#c0392b', dash: '6 4', width: 2 },
  network: { fill: 'none', stroke: '#8c959f', text: '#57606a', dash: '3 3' },
  cloud: { fill: '#f3f8ff', stroke: '#5b8bd0', text: '#3b6ea5' },
  other: { fill: '#f6f8fa', stroke: '#d0d7de', text: '#57606a' },
}
// Visual diff (see diff.js): colours and badges for compared versions
export const DIFF_STYLES = {
  added: { color: '#2e7d32', badge: '+', title: 'Added' },
  removed: { color: '#b3261e', badge: '−', title: 'Removed' },
  changed: { color: '#b26a00', badge: '~', title: 'Changed' },
}
const diffOf = (x) => (x.diff && x.diff.status !== 'same' ? DIFF_STYLES[x.diff.status] : null)

export const EDGE_STYLES = {
  sync: { stroke: '#57606a', width: 1.5 },
  async: { stroke: '#57606a', width: 1.5, dash: '6 4' },
  data: { stroke: '#3b6ea5', width: 2.5 },
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function wrap(text, max = WRAP) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 3).map((l) => (l.length > max + 8 ? l.slice(0, max + 7) + '…' : l))
}

function measureNode(n) {
  const lines = wrap(n.label)
  const longest = Math.max(...lines.map((l) => l.length))
  const icon = iconInfo(n.icon) ? ICON_SLOT : 0
  const width = icon + Math.max(120, longest * LABEL_PX + 32, n.tech ? n.tech.length * TECH_PX + 32 : 0)
  const pad = n.type === 'database' || n.type === 'storage' ? 34 : 24 // room for cylinder caps
  const height = Math.max(lines.length * LINE_H + (n.tech ? 14 : 0) + pad, icon ? 48 : 0)
  return { lines, icon, width: Math.round(width), height: Math.round(height) }
}

function buildGraph(model) {
  const measured = Object.fromEntries(model.nodes.map((n) => [n.id, measureNode(n)]))
  const kids = new Map()
  const add = (parent, child) => kids.set(parent, [...(kids.get(parent) || []), child])
  for (const n of model.nodes) {
    add(n.group ? `g_${n.group}` : 'root', { id: `n_${n.id}`, width: measured[n.id].width, height: measured[n.id].height })
  }
  for (const g of model.groups) {
    add(g.parent ? `g_${g.parent}` : 'root', {
      id: `g_${g.id}`,
      labels: [{ text: g.label, width: g.label.length * 7 + 8, height: 16 }],
      layoutOptions: {
        'elk.padding': '[top=40,left=18,bottom=18,right=18]',
        'elk.nodeLabels.placement': '[H_LEFT, V_TOP, INSIDE]',
      },
    })
  }
  const withChildren = (node) => ({ ...node, children: (kids.get(node.id) || []).map(withChildren) })
  const root = withChildren({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': model.direction === 'TD' ? 'DOWN' : 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.spacing.nodeNode': '32',
      'elk.spacing.edgeNode': '20',
      'elk.spacing.edgeEdge': '12',
      'elk.spacing.edgeLabel': '4',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      // keep model order as a tie-breaker so small edits don't reshuffle the whole diagram
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
      // all coordinates absolute, so drawing needs no offset bookkeeping
      'elk.json.shapeCoords': 'ROOT',
      'elk.json.edgeCoords': 'ROOT',
    },
  })
  root.edges = model.edges.map((e, i) => ({
    id: `e${i}`,
    sources: [`n_${e.from}`],
    targets: [`n_${e.to}`],
    labels: e.label ? [{
      text: e.label, width: e.label.length * 6.3 + 10, height: 18,
      layoutOptions: { 'elk.edgeLabels.inline': 'true', 'elk.edgeLabels.placement': 'CENTER' },
    }] : [],
  }))
  return { root, measured }
}

function nodeShape(type, x, y, w, h, fill, stroke, strokeWidth = 1.5) {
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"`
  switch (type) {
    case 'database':
    case 'storage': {
      const e = 8
      return `<path d="M${x},${y + e} a${w / 2},${e} 0 0 1 ${w},0 v${h - 2 * e} a${w / 2},${e} 0 0 1 ${-w},0 z" ${common}/>` +
        `<path d="M${x},${y + e} a${w / 2},${e} 0 0 0 ${w},0" fill="none" stroke="${stroke}" stroke-width="1.5"/>`
    }
    case 'cache': {
      const i = 14
      return `<polygon points="${x + i},${y} ${x + w - i},${y} ${x + w},${y + h / 2} ${x + w - i},${y + h} ${x + i},${y + h} ${x},${y + h / 2}" ${common}/>`
    }
    case 'queue':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" ${common}/>` +
        `<path d="M${x + 9},${y} v${h} M${x + w - 9},${y} v${h}" stroke="${stroke}" stroke-width="1.5"/>`
    case 'client':
    case 'user':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ${common}/>`
    case 'external':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ${common} stroke-dasharray="5 3"/>`
    case 'gateway': {
      const s = 10
      return `<polygon points="${x + s},${y} ${x + w},${y} ${x + w - s},${y + h} ${x},${y + h}" ${common}/>`
    }
    case 'function':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" ${common}/>`
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ${common}/>`
  }
}

function nodeText(n, m, x, y, w, h, strike = false) {
  const total = m.lines.length * LINE_H + (n.tech ? 14 : 0)
  const shift = n.type === 'database' || n.type === 'storage' ? 4 : 0
  let ty = y + (h - total) / 2 + 12 + shift
  const cx = x + m.icon + (w - m.icon) / 2 // text is centred in the space right of the icon
  let out = ''
  for (const line of m.lines) {
    out += `<text x="${cx}" y="${ty}" text-anchor="middle" font-size="13" font-weight="600" fill="#1f2328"${strike ? ' text-decoration="line-through"' : ''}>${esc(line)}</text>`
    ty += LINE_H
  }
  if (n.tech) out += `<text x="${cx}" y="${ty}" text-anchor="middle" font-size="11" fill="#57606a">${esc(n.tech)}</text>`
  return out
}

// Icon artwork (as a data URI) or, when it isn't available, a provider badge
function nodeIcon(n, x, y, h, icons) {
  const info = iconInfo(n.icon)
  if (!info) return ''
  const size = 28
  const ix = x + 8
  const iy = y + (h - size) / 2
  const data = icons.get(n.icon)
  if (data) return `<image x="${ix}" y="${iy}" width="${size}" height="${size}" xlink:href="${data}"><title>${esc(info.label)}</title></image>`
  return `<g><title>${esc(info.label)}</title><rect x="${ix}" y="${y + h / 2 - 8}" width="${size}" height="16" rx="4" fill="${info.providerColor}"/>` +
    `<text x="${ix + size / 2}" y="${y + h / 2 + 3.5}" text-anchor="middle" font-size="8" font-weight="700" fill="#ffffff">${esc(info.providerName)}</text></g>`
}

function collect(node, out = new Map()) {
  for (const c of node.children || []) {
    out.set(c.id, c)
    collect(c, out)
  }
  return out
}

/** Run ELK on a model. `shapes` maps "n_<id>" / "g_<id>" to absolute boxes. */
export async function layoutModel(model) {
  const { root, measured } = buildGraph(model)
  const laid = await elk.layout(root)
  return { laid, shapes: collect(laid), measured }
}

/**
 * Lay out a system model with ELK and return a standalone SVG string.
 * Cloud icons are fetched with `loadIcon(key) -> data URI | null` and embedded, so the SVG
 * has no external references; missing icons become provider badges.
 */
export async function modelToSvg(model, { loadIcon = fetchIcon } = {}) {
  const [{ laid, shapes, measured }, icons] = await Promise.all([layoutModel(model), loadIcons(model, loadIcon)])
  const W = Math.ceil(laid.width)
  const H = Math.ceil(laid.height)
  const parts = []

  // groups in model order: parents are listed before or after children, so sort by depth
  const depth = (g) => (g.parent ? 1 + depth(model.groups.find((p) => p.id === g.parent)) : 0)
  for (const g of [...model.groups].sort((a, b) => depth(a) - depth(b))) {
    const s = shapes.get(`g_${g.id}`)
    const st = GROUP_STYLES[g.kind] || GROUP_STYLES.other
    const df = diffOf(g)
    const stroke = df ? df.color : st.stroke
    const dash = g.diff?.status === 'removed' ? '6 4' : st.dash
    const label = df ? `${g.label} (${df.title.toLowerCase()})` : g.label
    parts.push(
      `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="10" fill="${st.fill}" stroke="${stroke}"` +
        ` stroke-width="${df ? 2 : st.width || 1.2}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` +
        `<text x="${s.x + 14}" y="${s.y + 24}" font-size="12" font-weight="700" fill="${df ? df.color : st.text}">${esc(label)}</text>`,
    )
  }

  const labels = []
  model.edges.forEach((e, i) => {
    const edge = laid.edges.find((x) => x.id === `e${i}`)
    const st = EDGE_STYLES[e.style] || EDGE_STYLES.sync
    const df = diffOf(e)
    const removed = e.diff?.status === 'removed'
    const dash = removed ? '5 4' : st.dash
    for (const sec of edge.sections || []) {
      const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint]
      const d = pts.map((p, j) => `${j ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
      parts.push(
        `<path d="${d}" fill="none" stroke="${df ? df.color : st.stroke}" stroke-width="${df ? Math.max(st.width, 2.2) : st.width}"` +
          `${dash ? ` stroke-dasharray="${dash}"` : ''}${removed ? ' opacity="0.6"' : ''}` +
          ` marker-end="url(#arrow-${df ? e.diff.status : e.style})">` +
          (df ? `<title>${esc(df.title)} connection${e.diff.changes.length ? `\n${esc(describeChanges(e.diff.changes))}` : ''}</title>` : '') +
          '</path>',
      )
    }
    for (const l of edge.labels || []) {
      labels.push(
        `<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" rx="4" fill="#ffffff" fill-opacity="0.92"/>` +
          `<text x="${l.x + l.width / 2}" y="${l.y + 13}" text-anchor="middle" font-size="11" fill="#57606a">${esc(l.text)}</text>`,
      )
    }
  })

  for (const n of model.nodes) {
    const s = shapes.get(`n_${n.id}`)
    const [fill, stroke] = NODE_COLORS[n.type] || DEFAULT_COLORS
    const df = diffOf(n)
    const removed = n.diff?.status === 'removed'
    let body = nodeShape(n.type, s.x, s.y, s.width, s.height, fill, df ? df.color : stroke, df ? 2.5 : 1.5) +
      nodeIcon(n, s.x, s.y, s.height, icons) + nodeText(n, measured[n.id], s.x, s.y, s.width, s.height, removed)
    if (df) {
      const tip = `${df.title}${n.diff.changes.length ? `\n${describeChanges(n.diff.changes)}` : ''}`
      body = `<g${removed ? ' opacity="0.55"' : ''}><title>${esc(tip)}</title>${body}` +
        `<circle cx="${s.x + s.width - 4}" cy="${s.y + 4}" r="9" fill="${df.color}" stroke="#ffffff" stroke-width="2"/>` +
        `<text x="${s.x + s.width - 4}" y="${s.y + 8.5}" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">${df.badge}</text></g>`
    }
    parts.push(body)
  }

  const markerColors = [
    ...Object.entries(EDGE_STYLES).map(([k, st]) => [k, st.stroke]),
    ...Object.entries(DIFF_STYLES).map(([k, st]) => [k, st.color]),
  ]
  const markers = markerColors
    .map(([k, color]) =>
      `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
        `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`)
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">` +
    `<defs>${markers}</defs><rect width="${W}" height="${H}" fill="#ffffff"/>` +
    parts.join('') + labels.join('') + '</svg>'
  )
}
