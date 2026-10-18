// Helpers shared by the exporters. Every exporter takes a validated system model
// (see backend/studio/sysmodel.py) and produces a file in another tool's format.

export const nid = (id) => `n_${id}`
export const gid = (id) => `g_${id}`

/** Groups and nodes keyed by parent group id (null = top level). */
export function hierarchy(model) {
  const groups = new Map()
  const nodes = new Map()
  for (const g of model.groups) groups.set(g.parent ?? null, [...(groups.get(g.parent ?? null) || []), g])
  for (const n of model.nodes) nodes.set(n.group ?? null, [...(nodes.get(n.group ?? null) || []), n])
  return { groupsIn: (p) => groups.get(p) || [], nodesIn: (p) => nodes.get(p) || [] }
}

/** Depth-first walk: onGroup(g, depth, inner) where inner() walks the group's contents. */
export function walk(model, { onNode, onGroup }) {
  const h = hierarchy(model)
  const visit = (parent, depth) => {
    for (const n of h.nodesIn(parent)) onNode(n, depth)
    for (const g of h.groupsIn(parent)) onGroup(g, depth, () => visit(g.id, depth + 1))
  }
  visit(null, 0)
}

export const escXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

/** Small deterministic hash, so exports are stable (same model -> same file). */
export function hash(s) {
  let h = 2166136261
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
