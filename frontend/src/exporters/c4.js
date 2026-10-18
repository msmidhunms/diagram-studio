// System model -> C4 container diagram in C4-PlantUML (https://github.com/plantuml-stdlib/C4-PlantUML).
// Users become Persons, external services become external Systems, everything else is a
// Container (Db / Queue variants by type); groups become Boundaries.
import { gid, nid, walk } from './common'

const MACRO = {
  user: 'Person',
  external: 'System_Ext',
  database: 'ContainerDb',
  storage: 'ContainerDb',
  queue: 'ContainerQueue',
}

const str = (s) => String(s ?? '').replace(/"/g, "'")

export function toC4(model, title = '') {
  const out = ['@startuml', '!include <C4/C4_Container>', '']
  out.push(model.direction === 'TD' ? 'LAYOUT_TOP_DOWN()' : 'LAYOUT_LEFT_RIGHT()')
  if (title) out.push(`title ${str(title)}`)
  out.push('')
  walk(model, {
    onNode(n, depth) {
      const pad = '  '.repeat(depth)
      // third argument: technology for Containers, description for Person/System_Ext
      out.push(`${pad}${MACRO[n.type] || 'Container'}(${nid(n.id)}, "${str(n.label)}", "${str(n.tech)}")`)
    },
    onGroup(g, depth, inner) {
      const pad = '  '.repeat(depth)
      out.push(`${pad}Boundary(${gid(g.id)}, "${str(g.label)}") {`)
      inner()
      out.push(`${pad}}`)
    },
  })
  out.push('')
  for (const e of model.edges) {
    // technology slot shows the interaction style, e.g. [async]
    const tech = e.style === 'sync' ? '' : `, "${e.style}"`
    out.push(`Rel(${nid(e.from)}, ${nid(e.to)}, "${str(e.label)}"${tech})`)
  }
  out.push('', 'SHOW_LEGEND()', '@enduml')
  return out.join('\n') + '\n'
}
