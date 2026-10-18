// System model -> PlantUML component diagram.
import { iconInfo } from '../icons'
import { gid, nid, walk } from './common'

/** !include lines and a macro name per icon, from PlantUML's standard library. */
export function pumlIcons(model) {
  const includes = new Set()
  const macros = {}
  for (const n of model.nodes) {
    const info = iconInfo(n.icon)
    if (!info?.puml) continue
    includes.add(`!include <${info.pumlLib}/${info.pumlCommon}>`)
    includes.add(`!include <${info.pumlLib}/${info.puml}>`)
    macros[n.id] = { macro: info.puml.split('/').pop(), service: info.label }
  }
  // the provider's common file must come before its service files
  return { includes: [...includes].sort((a, b) => b.includes('Common') - a.includes('Common')), macros }
}

const ELEMENT = {
  service: 'component',
  database: 'database',
  storage: 'storage',
  cache: 'collections',
  queue: 'queue',
  client: 'rectangle',
  user: 'actor',
  external: 'cloud',
  gateway: 'hexagon',
  function: 'agent',
  other: 'rectangle',
}
const GROUP = {
  tier: 'rectangle "%s" as %s',
  trust_zone: 'rectangle "%s" as %s #line.dashed;line:C0392B;text:C0392B',
  network: 'rectangle "%s" as %s #line.dashed',
  cloud: 'cloud "%s" as %s',
  other: 'rectangle "%s" as %s',
}
const ARROW = { sync: '-->', async: '..>', data: '-[#3B6EA5,bold]->' }

// PlantUML strings can't escape double quotes; stereotypes can't contain << >>
const str = (s) => String(s).replace(/"/g, "'")
const stereo = (s) => String(s).replace(/[<>]/g, '')

export function toPlantUml(model, title = '') {
  const { includes, macros } = pumlIcons(model)
  const out = ['@startuml', ...includes]
  if (title) out.push(`title ${str(title)}`)
  out.push(model.direction === 'TD' ? 'top to bottom direction' : 'left to right direction',
    'skinparam shadowing false', 'skinparam componentStyle rectangle', '')
  walk(model, {
    onNode(n, depth) {
      if (macros[n.id]) {
        // the technology slot is required by these macros; default to the service name, e.g. [Amazon SQS]
        const { macro, service } = macros[n.id]
        out.push(`${'  '.repeat(depth)}${macro}(${nid(n.id)}, "${str(n.label)}", "${str(n.tech || service)}")`)
        return
      }
      const tech = n.tech ? ` <<${stereo(n.tech)}>>` : ''
      out.push(`${'  '.repeat(depth)}${ELEMENT[n.type] || 'rectangle'} "${str(n.label)}" as ${nid(n.id)}${tech}`)
    },
    onGroup(g, depth, inner) {
      const pad = '  '.repeat(depth)
      out.push(pad + (GROUP[g.kind] || GROUP.other).replace('%s', str(g.label)).replace('%s', gid(g.id)) + ' {')
      inner()
      out.push(`${pad}}`)
    },
  })
  out.push('')
  for (const e of model.edges) {
    out.push(`${nid(e.from)} ${ARROW[e.style] || ARROW.sync} ${nid(e.to)}${e.label ? ` : ${str(e.label)}` : ''}`)
  }
  out.push('@enduml')
  return out.join('\n') + '\n'
}
