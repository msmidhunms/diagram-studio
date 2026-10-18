// System model -> D2 (https://d2lang.com). Groups become containers; edges use full
// container paths (e.g. g_vpc.g_data.n_db) because D2 scopes keys to their container.
import { GROUP_STYLES, NODE_COLORS } from '../autolayout'
import { gid, nid, walk } from './common'

const SHAPE = {
  database: 'cylinder',
  storage: 'cylinder',
  cache: 'hexagon',
  queue: 'queue',
  client: 'oval',
  user: 'person',
  external: 'cloud',
  gateway: 'parallelogram',
}

const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function toD2(model, title = '') {
  const out = []
  if (title) out.push(`# ${title.replace(/\n/g, ' ')}`)
  out.push(`direction: ${model.direction === 'TD' ? 'down' : 'right'}`, '')

  const path = {}
  const parents = Object.fromEntries(model.groups.map((g) => [g.id, g.parent]))
  const groupPath = (id) => (id ? [...groupPath(parents[id]), gid(id)] : [])
  for (const n of model.nodes) path[n.id] = [...groupPath(n.group), nid(n.id)].join('.')

  walk(model, {
    onNode(n, depth) {
      const pad = '  '.repeat(depth)
      const label = n.tech ? `${n.label}\n${n.tech}` : n.label
      const props = []
      if (SHAPE[n.type]) props.push(`shape: ${SHAPE[n.type]}`)
      const colors = NODE_COLORS[n.type]
      if (colors) props.push(`style: {fill: "${colors[0]}"; stroke: "${colors[1]}"}`)
      if (n.type === 'external') props.push('style.stroke-dash: 4')
      out.push(`${pad}${nid(n.id)}: ${q(label).replace(/\n/g, '\\n')}${props.length ? ` {${props.join('; ')}}` : ''}`)
    },
    onGroup(g, depth, inner) {
      const pad = '  '.repeat(depth)
      const st = GROUP_STYLES[g.kind] || GROUP_STYLES.other
      out.push(`${pad}${gid(g.id)}: ${q(g.label)} {`)
      const style = [`stroke: "${st.stroke}"`]
      if (st.fill !== 'none') style.push(`fill: "${st.fill}"`)
      if (st.dash) style.push('stroke-dash: 4')
      out.push(`${pad}  style: {${style.join('; ')}}`)
      inner()
      out.push(`${pad}}`)
    },
  })
  out.push('')
  for (const e of model.edges) {
    const style = e.style === 'async' ? ' {style.stroke-dash: 4}' : e.style === 'data' ? ' {style: {stroke: "#3b6ea5"; stroke-width: 3}}' : ''
    out.push(`${path[e.from]} -> ${path[e.to]}${e.label ? `: ${q(e.label)}` : ''}${style}`)
  }
  return out.join('\n') + '\n'
}
