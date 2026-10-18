import { describe, expect, it } from 'vitest'
import model from '../__fixtures__/ecommerce.json'
import { MODEL_EXPORTS } from '.'
import { toC4 } from './c4'
import { toD2 } from './d2'
import { toDrawio } from './drawio'
import { toExcalidraw } from './excalidraw'
import { toPlantUml } from './plantuml'

const nasty = {
  direction: 'TD',
  groups: [{ id: 'z', label: 'Zone "A" & <B>', kind: 'trust_zone', parent: null }],
  nodes: [
    { id: 'a', label: 'Say "hi" <b>&</b>', type: 'service', group: 'z', tech: 'C<<++>>' },
    { id: 'b', label: 'Back\\slash', type: 'database', group: null, tech: null },
  ],
  edges: [{ from: 'a', to: 'b', label: 'q"uote', style: 'async' }],
}

describe('PlantUML', () => {
  it('declares every node and edge inside balanced blocks', () => {
    const out = toPlantUml(model, 'Shop')
    expect(out.startsWith('@startuml\ntitle Shop\nleft to right direction')).toBe(true)
    expect(out.trim().endsWith('@enduml')).toBe(true)
    for (const n of model.nodes) expect(out).toContain(`as n_${n.id}`)
    expect(out.match(/\{/g).length).toBe(out.match(/\}/g).length)
    expect(out).toContain('database "Orders DB" as n_db <<PostgreSQL 16>>')
    expect(out).toContain('n_orders ..> n_events : order.created')
  })
  it('neutralises quotes and stereotype brackets', () => {
    const out = toPlantUml(nasty)
    expect(out).toContain(`component "Say 'hi' <b>&</b>" as n_a <<C++>>`)
    expect(out).toContain('top to bottom direction')
  })
})

describe('C4', () => {
  it('maps types to C4 macros and groups to boundaries', () => {
    const out = toC4(model)
    expect(out).toContain('!include <C4/C4_Container>')
    expect(out).toContain('Person(n_user, "Customer", "")')
    expect(out).toContain('ContainerDb(n_db, "Orders DB", "PostgreSQL 16")')
    expect(out).toContain('ContainerQueue(n_events, "Order events", "Kafka")')
    expect(out).toContain('System_Ext(n_stripe, "Stripe payments", "")')
    expect(out.match(/Boundary\(/g)).toHaveLength(model.groups.length)
    expect(out.match(/^Rel\(/gm)).toHaveLength(model.edges.length)
    expect(out).toContain('Rel(n_orders, n_events, "order.created", "async")')
  })
})

describe('D2', () => {
  it('nests containers and references nodes by full path', () => {
    const out = toD2(model)
    expect(out).toContain('direction: right')
    expect(out).toContain('g_vpc.n_orders -> g_vpc.g_data.n_db: "SQL"')
    expect(out).toContain('g_vpc.g_data.n_db -> g_vpc.g_data.n_replica: "replication" {style: {stroke: "#3b6ea5"; stroke-width: 3}}')
    expect(out).toContain('n_db: "Orders DB\\nPostgreSQL 16" {shape: cylinder')
  })
  it('escapes quotes and backslashes', () => {
    const out = toD2(nasty)
    expect(out).toContain('g_z: "Zone \\"A\\" & <B>" {')
    expect(out).toContain('n_b: "Back\\\\slash"')
    expect(out).toContain('g_z.n_a -> n_b: "q\\"uote" {style.stroke-dash: 4}')
  })
})

describe('draw.io', () => {
  it('emits one cell per group/node/edge with child geometry relative to its container', async () => {
    const out = await toDrawio(model, 'Shop')
    expect(out.match(/vertex="1"/g)).toHaveLength(model.nodes.length + model.groups.length)
    expect(out.match(/edge="1"/g)).toHaveLength(model.edges.length)
    expect(out).toMatch(/<mxCell id="n_db" [^>]*parent="g_data"/)
    expect(out).toMatch(/<mxCell id="g_data" [^>]*parent="g_vpc"/)
    const x = Number(out.match(/<mxCell id="n_db"[^]*?<mxGeometry x="(\d+)"/)[1])
    expect(x).toBeLessThan(400) // relative to the Data tier box, not the page
  })
  it('double-escapes labels (HTML inside an XML attribute)', async () => {
    const out = await toDrawio(nasty)
    // user text is HTML-escaped (&lt;b&gt;) and then XML-escaped (&amp;lt;b&amp;gt;); our own <b> only once
    expect(out).toContain('value="&lt;b&gt;Say &quot;hi&quot; &amp;lt;b&amp;gt;&amp;amp;&amp;lt;/b&amp;gt;&lt;/b&gt;')
    expect(out).not.toMatch(/value="[^"]*<b>/)
  })
})

describe('Excalidraw', () => {
  it('produces a scene whose bindings all point at real elements', async () => {
    const scene = JSON.parse(await toExcalidraw(model))
    expect(scene.type).toBe('excalidraw')
    const ids = new Map(scene.elements.map((e) => [e.id, e]))
    const arrows = scene.elements.filter((e) => e.type === 'arrow')
    expect(arrows).toHaveLength(model.edges.length)
    for (const a of arrows) {
      for (const b of [a.startBinding, a.endBinding]) {
        expect(ids.get(b.elementId).boundElements).toContainEqual({ type: 'arrow', id: a.id })
      }
      expect(a.points[0]).toEqual([0, 0])
    }
    for (const t of scene.elements.filter((e) => e.type === 'text' && e.containerId)) {
      expect(ids.get(t.containerId).boundElements).toContainEqual({ type: 'text', id: t.id })
    }
  })
})

it('every export is deterministic', async () => {
  for (const f of MODEL_EXPORTS) expect(await f.build(model, 'T'), f.id).toBe(await f.build(model, 'T'))
})
