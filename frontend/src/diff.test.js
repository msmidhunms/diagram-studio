import { describe, expect, it } from 'vitest'
import ecommerce from '../../shared/fixtures/ecommerce.json'
import { modelToSvg } from './autolayout'
import { describeChanges, diffModels } from './diff'
import { deriveModel } from './views'

const noIcons = { loadIcon: () => Promise.resolve(null) }

// v2 of the shop: replica removed, a search service added, orders moved to Go, Stripe call now async
const v2 = {
  ...ecommerce,
  groups: [...ecommerce.groups, { id: 'search_tier', label: 'Search', kind: 'tier', parent: 'vpc' }],
  nodes: [
    ...ecommerce.nodes.filter((n) => n.id !== 'replica').map((n) => (n.id === 'orders' ? { ...n, tech: 'Go 1.24' } : n)),
    { id: 'search', label: 'Search service', type: 'service', group: 'search_tier', tech: null },
  ],
  edges: [
    ...ecommerce.edges.filter((e) => e.to !== 'replica').map((e) => (e.to === 'stripe' ? { ...e, style: 'async' } : e)),
    { from: 'gw', to: 'search', label: null, style: 'sync' },
  ],
}

const status = (list, id) => list.find((x) => (x.id ?? `${x.from}->${x.to}`) === id).diff.status

describe('diffModels', () => {
  it('marks added, removed, changed and unchanged items', () => {
    const { model, summary } = diffModels(ecommerce, v2)
    expect(status(model.nodes, 'search')).toBe('added')
    expect(status(model.nodes, 'replica')).toBe('removed')
    expect(status(model.nodes, 'orders')).toBe('changed')
    expect(status(model.nodes, 'db')).toBe('same')
    expect(status(model.edges, 'gw->search')).toBe('added')
    expect(status(model.edges, 'db->replica')).toBe('removed')
    expect(status(model.edges, 'orders->stripe')).toBe('changed')
    expect(status(model.groups, 'search_tier')).toBe('added')
    expect(summary).toEqual({
      nodes: { added: 1, removed: 1, changed: 1 }, edges: { added: 1, removed: 1, changed: 1 },
      groups: { added: 1, removed: 0, changed: 0 }, identical: false,
    })
  })

  it('explains what changed', () => {
    const orders = diffModels(ecommerce, v2).model.nodes.find((n) => n.id === 'orders')
    expect(describeChanges(orders.diff.changes)).toBe('tech: Django 5 → Go 1.24')
  })

  it('removed nodes keep their old group, so they appear where they were', () => {
    const replica = diffModels(ecommerce, v2).model.nodes.find((n) => n.id === 'replica')
    expect(replica.group).toBe('data')
  })

  it('reports identical versions', () => {
    expect(diffModels(ecommerce, ecommerce).summary.identical).toBe(true)
  })

  it('handles an id that changed from node to group without duplicates', () => {
    const after = { ...ecommerce, groups: [...ecommerce.groups, { id: 'replica', label: 'Replica set', kind: 'tier', parent: null }],
      nodes: ecommerce.nodes.filter((n) => n.id !== 'replica'), edges: ecommerce.edges.filter((e) => e.to !== 'replica') }
    const { model } = diffModels(ecommerce, after)
    const ids = [...model.nodes, ...model.groups].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('works on derived views too', () => {
    const { model } = diffModels(deriveModel(ecommerce, 'overview'), deriveModel(v2, 'overview'))
    expect(status(model.nodes, 'search_tier_box')).toBe('added')
  })
})

describe('diff rendering', () => {
  it('colours and badges changed items, strikes through removed ones', async () => {
    const svg = await modelToSvg(diffModels(ecommerce, v2).model, noIcons)
    expect(svg.match(/fill="#ffffff">\+<\/text>/g)).toHaveLength(1)
    expect(svg.match(/fill="#ffffff">−<\/text>/g)).toHaveLength(1)
    expect(svg.match(/fill="#ffffff">~<\/text>/g)).toHaveLength(1)
    expect(svg).toContain('text-decoration="line-through">Read replica</text>')
    expect(svg).toContain('<title>Changed\ntech: Django 5 → Go 1.24</title>')
    expect(svg).toContain('marker-end="url(#arrow-removed)"')
    expect(svg).toContain('Search (added)')
  })
  it('renders a normal model exactly as before (no diff fields)', async () => {
    const svg = await modelToSvg(ecommerce, noIcons)
    expect(svg).not.toMatch(/arrow-(added|removed|changed)\)"/)
    expect(svg).not.toContain('line-through')
  })
})
