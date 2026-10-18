import { describe, expect, it } from 'vitest'
import ecommerce from './__fixtures__/ecommerce.json'
import { layoutModel, modelToSvg, wrap } from './autolayout'

const inside = (a, b) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height
const overlap = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('autolayout', () => {
  it('places every node inside its (nested) group, with no overlaps', async () => {
    const { shapes } = await layoutModel(ecommerce)
    for (const n of ecommerce.nodes) {
      if (n.group) expect(inside(shapes.get(`n_${n.id}`), shapes.get(`g_${n.group}`)), n.id).toBe(true)
    }
    for (const g of ecommerce.groups) {
      if (g.parent) expect(inside(shapes.get(`g_${g.id}`), shapes.get(`g_${g.parent}`)), g.id).toBe(true)
    }
    const boxes = ecommerce.nodes.map((n) => shapes.get(`n_${n.id}`))
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false)
  })

  it('draws all nodes, groups and edges into a standalone SVG', async () => {
    const svg = await modelToSvg(ecommerce)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+"/)
    for (const n of ecommerce.nodes) expect(svg).toContain(n.label.replace('&', '&#38;'))
    for (const g of ecommerce.groups) expect(svg).toContain(g.label)
    expect(svg.match(/marker-end=/g)).toHaveLength(ecommerce.edges.length)
    expect(svg).toContain('stroke-dasharray="6 4"') // async edge / trust zone
  })

  it('escapes text so labels cannot inject markup', async () => {
    const svg = await modelToSvg({
      direction: 'TD', groups: [],
      nodes: [{ id: 'a', label: '<script>alert(1)</script>', type: 'service', group: null, tech: 'a"b' }],
      edges: [{ from: 'a', to: 'a', label: '</text>', style: 'sync' }],
    })
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&#60;/text&#62;') // edge label escaped
    expect(svg).toContain('&#60;script&#62;')
  })

  it('lays out top-down when asked', async () => {
    const m = { ...ecommerce, groups: [], nodes: ecommerce.nodes.slice(0, 2).map((n) => ({ ...n, group: null })),
      edges: [ecommerce.edges[0]], direction: 'TD' }
    const { shapes } = await layoutModel(m)
    expect(shapes.get('n_spa').y).toBeGreaterThan(shapes.get('n_user').y)
  })

  it('wraps long labels into at most three lines', () => {
    expect(wrap('Customer')).toEqual(['Customer'])
    const lines = wrap('A very long component name that keeps going and going well past three lines')
    expect(lines.length).toBe(3)
    expect(lines.every((l) => l.length <= 32)).toBe(true)
  })
})
