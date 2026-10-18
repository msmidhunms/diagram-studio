import fs from 'fs'
import { describe, expect, it } from 'vitest'
import ecommerce from '../../shared/fixtures/ecommerce.json'
import multicloud from './__fixtures__/multicloud.json'
import { sequenceSteps, toMermaid, toMermaidSequence } from './exporters/mermaid'
import { VIEWS, dataflow, deployment, deriveModel, overview } from './views'

/** Same rules the backend applies (sysmodel.validate_model): ids unique, references resolve. */
function assertValid(m) {
  const ids = [...m.nodes.map((n) => n.id), ...m.groups.map((g) => g.id)]
  expect(new Set(ids).size, 'unique ids').toBe(ids.length)
  const groups = new Set(m.groups.map((g) => g.id))
  for (const n of m.nodes) if (n.group) expect(groups.has(n.group), `group of ${n.id}`).toBe(true)
  for (const g of m.groups) if (g.parent) expect(groups.has(g.parent), `parent of ${g.id}`).toBe(true)
  const nodes = new Set(m.nodes.map((n) => n.id))
  for (const e of m.edges) expect(nodes.has(e.from) && nodes.has(e.to), `${e.from}->${e.to}`).toBe(true)
}

describe('Mermaid port', () => {
  it('matches the Python renderer byte for byte (shared golden file)', () => {
    const golden = fs.readFileSync(new URL('../../shared/fixtures/ecommerce.mmd', import.meta.url), 'utf8')
    expect(toMermaid(ecommerce) + '\n').toBe(golden)
  })
})

describe('views', () => {
  it('every view of every fixture is a valid model', () => {
    for (const m of [ecommerce, multicloud]) for (const v of VIEWS) assertValid(deriveModel(m, v.id))
  })

  it('high-level collapses tiers into boxes and keeps boundaries', () => {
    const o = overview(ecommerce)
    expect(o.groups.map((g) => g.id).sort()).toEqual(['pub', 'vpc']) // "Data tier" collapsed
    const box = o.nodes.find((n) => n.id === 'data_box')
    expect(box).toMatchObject({ label: 'Data tier', group: 'vpc', tech: '3 components' })
    // orders -> cache and orders -> db (SQL) merge into one edge; replication inside the tier disappears
    const toBox = o.edges.filter((e) => e.from === 'orders' && e.to === 'data_box')
    expect(toBox).toHaveLength(1)
    expect(toBox[0].label).toBe('SQL')
    expect(o.edges.some((e) => e.from === e.to)).toBe(false)
  })

  it('box ids never clash with existing ids', () => {
    const m = { ...ecommerce, nodes: [...ecommerce.nodes, { id: 'data_box', label: 'X', type: 'service', group: null, tech: null }] }
    assertValid(overview(m))
  })

  it('deployment dissolves tiers into the nearest boundary', () => {
    const d = deployment(ecommerce)
    expect(d.groups.map((g) => g.id).sort()).toEqual(['pub', 'vpc'])
    expect(d.nodes.find((n) => n.id === 'db').group).toBe('vpc')
    expect(d.nodes).toHaveLength(ecommerce.nodes.length)
  })

  it('data flow keeps data-moving edges and trust zones only', () => {
    const f = dataflow(multicloud)
    expect(f.groups.map((g) => g.kind)).toEqual(['trust_zone'])
    expect(f.edges.every((e) => e.style !== 'sync' || ['table', 'queue', 'cosmos', 'bq'].some((d) => [e.from, e.to].includes(d)))).toBe(true)
    expect(f.nodes.map((n) => n.id)).not.toContain('auth') // only a sync JWT check
    expect(f.nodes.map((n) => n.id)).toContain('afn')
  })
})

describe('sequence', () => {
  it('walks from the user in call order and covers every edge once', () => {
    const steps = sequenceSteps(ecommerce)
    expect(steps).toHaveLength(ecommerce.edges.length)
    expect(steps.slice(0, 3).map((e) => `${e.from}->${e.to}`)).toEqual(['user->spa', 'spa->gw', 'gw->orders'])
  })
  it('renders participants and safe message text', () => {
    const m = { ...ecommerce, edges: [...ecommerce.edges, { from: 'orders', to: 'stripe', label: 'refund; #2: retry', style: 'async' }] }
    const out = toMermaidSequence(m)
    expect(out.startsWith('sequenceDiagram\n  autonumber\n  actor n_user as Customer')).toBe(true)
    expect(out).toContain('n_orders-)n_events: order.created')
    expect(out).toContain('n_orders-)n_stripe: refund   2 - retry')
    expect(out).toContain('n_gw->>n_orders: call') // unlabelled sync edge
  })
})
