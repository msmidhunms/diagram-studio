// System model -> Mermaid. toMermaid is a port of backend/studio/render_mermaid.py so views
// derived in the browser render exactly like stored versions; both are checked against
// src/__fixtures__/ecommerce.mmd (frontend and backend tests), which keeps them in sync.
import { nid, gid } from './common'

const SHAPES = {
  database: ['[(', ')]'],
  storage: ['[(', ')]'],
  cache: ['{{', '}}'],
  queue: ['[[', ']]'],
  client: ['([', '])'],
  user: ['([', '])'],
  external: ['[/', '/]'],
  gateway: ['[/', '\\]'],
  function: ['(', ')'],
}
const ARROWS = { sync: '-->', async: '-.->', data: '==>' }
const CLASSES = {
  database: 'fill:#e8f1fb,stroke:#3b6ea5',
  storage: 'fill:#e8f1fb,stroke:#3b6ea5',
  cache: 'fill:#fdf1e3,stroke:#c07a2c',
  queue: 'fill:#f3ecfa,stroke:#7d55a8',
  external: 'fill:#f2f2f2,stroke:#777,stroke-dasharray:4 3',
  client: 'fill:#eaf6ee,stroke:#3f8a57',
  user: 'fill:#eaf6ee,stroke:#3f8a57',
}
const GROUP_STYLES = {
  trust_zone: 'fill:transparent,stroke:#c0392b,stroke-width:2px,stroke-dasharray:6 4',
  network: 'fill:transparent,stroke:#7f8c8d,stroke-dasharray:3 3',
  cloud: 'fill:#f7fbff,stroke:#5b8bd0',
}

// Mermaid entity codes keep quotes and brackets from breaking the syntax
const q = (text) => '"' + String(text).replaceAll('"', '#quot;').replaceAll('<', '#lt;').replaceAll('>', '#gt;') + '"'

export function toMermaid(model) {
  const lines = [`flowchart ${model.direction}`]
  const children = new Map()
  const members = new Map()
  const push = (map, key, v) => map.set(key, [...(map.get(key) || []), v])
  for (const g of model.groups) push(children, g.parent ?? null, g)
  for (const n of model.nodes) push(members, n.group ?? null, n)

  const nodeLine = (n, pad) => {
    let label = q(n.label)
    if (n.tech) label = label.slice(0, -1) + '<br/>' + q(n.tech).slice(1)
    const [o, c] = SHAPES[n.type] || ['[', ']']
    return `${pad}${nid(n.id)}${o}${label}${c}`
  }
  const emit = (parent, depth) => {
    const pad = '  '.repeat(depth)
    for (const n of members.get(parent) || []) lines.push(nodeLine(n, pad))
    for (const g of children.get(parent) || []) {
      lines.push(`${pad}subgraph ${gid(g.id)}[${q(g.label)}]`)
      emit(g.id, depth + 1)
      lines.push(`${pad}end`)
    }
  }
  emit(null, 1)
  for (const e of model.edges) {
    const label = e.label ? `|${q(e.label)}|` : ''
    lines.push(`  ${nid(e.from)} ${ARROWS[e.style]}${label} ${nid(e.to)}`)
  }
  const used = new Set(model.nodes.map((n) => n.type))
  for (const [t, style] of Object.entries(CLASSES)) if (used.has(t)) lines.push(`  classDef ${t} ${style}`)
  for (const n of model.nodes) if (CLASSES[n.type]) lines.push(`  class ${nid(n.id)} ${n.type}`)
  for (const g of model.groups) if (GROUP_STYLES[g.kind]) lines.push(`  style ${gid(g.id)} ${GROUP_STYLES[g.kind]}`)
  return lines.join('\n')
}

// sequence message arrows: sync call, async message, data transfer
const SEQ_ARROWS = { sync: '->>', async: '-)', data: '->>' }
const SEQ_DEFAULT_TEXT = { sync: 'call', async: 'event', data: 'data' } // for unlabelled edges
const ACTOR_TYPES = new Set(['user'])
// Mermaid sequence text can't contain ; or # (comment / entity) and : splits the message
const seqText = (s) => String(s).replace(/[;#]/g, ' ').replace(/:/g, ' -').trim()

/**
 * Request flow as a Mermaid sequence diagram. The model has no call order, so the order is
 * inferred: depth-first from entry points (users, clients, then nodes nothing calls),
 * following each node's outgoing edges in model order; unreached edges come last.
 */
export function sequenceSteps(model) {
  const out = new Map()
  model.edges.forEach((e, i) => out.set(e.from, [...(out.get(e.from) || []), i]))
  const incoming = new Set(model.edges.map((e) => e.to))
  const entries = [
    ...model.nodes.filter((n) => n.type === 'user'),
    ...model.nodes.filter((n) => n.type === 'client'),
    ...model.nodes.filter((n) => !incoming.has(n.id)),
  ]
  const used = new Set()
  const steps = []
  const visit = (id) => {
    for (const i of out.get(id) || []) {
      if (used.has(i)) continue
      used.add(i)
      steps.push(model.edges[i])
      visit(model.edges[i].to)
    }
  }
  for (const n of entries) visit(n.id)
  model.edges.forEach((e, i) => { if (!used.has(i)) steps.push(e) })
  return steps
}

export function toMermaidSequence(model) {
  const steps = sequenceSteps(model)
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const order = []
  for (const e of steps) for (const id of [e.from, e.to]) if (!order.includes(id)) order.push(id)
  for (const n of model.nodes) if (!order.includes(n.id)) order.push(n.id) // isolated nodes
  const lines = ['sequenceDiagram', '  autonumber']
  for (const id of order) {
    const n = byId.get(id)
    lines.push(`  ${ACTOR_TYPES.has(n.type) ? 'actor' : 'participant'} ${nid(id)} as ${seqText(n.label)}`)
  }
  for (const e of steps) {
    lines.push(`  ${nid(e.from)}${SEQ_ARROWS[e.style] || '->>'}${nid(e.to)}: ${seqText(e.label || SEQ_DEFAULT_TEXT[e.style] || 'call')}`)
  }
  return lines.join('\n')
}
