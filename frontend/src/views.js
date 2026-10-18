// Views derived from one system model, in the browser, without the LLM.
// Each derive function returns a valid system model (or Mermaid text for the sequence view),
// so every renderer and exporter works on a view exactly as on the full diagram.

export const VIEWS = [
  { id: 'full', label: 'Full', hint: 'Everything in the model' },
  { id: 'overview', label: 'High-level', hint: 'Tiers collapsed into single boxes; boundaries kept' },
  { id: 'deployment', label: 'Deployment', hint: 'Where things run: cloud, network and trust boundaries' },
  { id: 'dataflow', label: 'Data flow', hint: 'Connections that move or store data, with trust boundaries' },
  { id: 'sequence', label: 'Sequence', hint: 'Request flow, ordered from users and clients (inferred)' },
]

const BOUNDARY_KINDS = new Set(['trust_zone', 'network', 'cloud'])
const DATA_TYPES = new Set(['database', 'storage', 'cache', 'queue'])
const STYLE_RANK = { sync: 0, async: 1, data: 2 } // when merging edges, the first wins

const isBoundary = (g) => BOUNDARY_KINDS.has(g.kind)

/** Nearest ancestor group (including itself) that passes keep(), or null. */
function nearestKept(groupId, groupsById, keep) {
  let g = groupId ? groupsById.get(groupId) : null
  while (g && !keep(g)) g = g.parent ? groupsById.get(g.parent) : null
  return g ? g.id : null
}

/** Remove groups that ended up with no nodes and no non-empty subgroups. */
function pruneGroups(groups, nodes) {
  const used = new Set(nodes.map((n) => n.group).filter(Boolean))
  let kept = groups
  for (;;) {
    const parents = new Set(kept.map((g) => g.parent).filter(Boolean))
    const next = kept.filter((g) => used.has(g.id) || parents.has(g.id))
    if (next.length === kept.length) return kept
    kept = next
  }
}

/** Merge edges between the same pair (labels combined); drop self-loops created by collapsing. */
function mergeEdges(edges) {
  const merged = new Map()
  for (const e of edges) {
    if (e.from === e.to) continue
    const key = `${e.from}->${e.to}`
    const m = merged.get(key)
    if (!m) {
      merged.set(key, { ...e, labels: e.label ? [e.label] : [] })
      continue
    }
    if (e.label && !m.labels.includes(e.label)) m.labels.push(e.label)
    if (STYLE_RANK[e.style] < STYLE_RANK[m.style]) m.style = e.style
  }
  return [...merged.values()].map(({ labels, ...e }) => ({
    ...e, label: labels.length > 2 ? `${labels.slice(0, 2).join(', ')} …` : labels.join(', ') || null,
  }))
}

/** High-level: every logical group (tier/other) becomes one box; boundaries stay containers. */
export function overview(model) {
  const groupsById = new Map(model.groups.map((g) => [g.id, g]))
  // the outermost non-boundary group a node belongs to is what it collapses into
  const collapseTarget = (groupId) => {
    let target = null
    for (let g = groupId ? groupsById.get(groupId) : null; g; g = g.parent ? groupsById.get(g.parent) : null) {
      if (!isBoundary(g)) target = g
    }
    return target
  }
  const nodes = []
  const into = new Map() // node id -> id of the node that now represents it
  const counts = new Map()
  const taken = new Set([...model.nodes.map((n) => n.id), ...model.groups.map((g) => g.id)])
  const boxId = new Map() // group id -> id of its box, unique among node and group ids
  const boxFor = (g) => {
    if (!boxId.has(g.id)) {
      let id = `${g.id}_box`
      while (taken.has(id)) id += '_'
      taken.add(id)
      boxId.set(g.id, id)
    }
    return boxId.get(g.id)
  }
  for (const n of model.nodes) {
    const t = collapseTarget(n.group)
    if (!t) {
      nodes.push(n)
      into.set(n.id, n.id)
      continue
    }
    const id = boxFor(t)
    into.set(n.id, id)
    counts.set(id, (counts.get(id) || 0) + 1)
    if (!nodes.some((x) => x.id === id)) {
      nodes.push({ id, label: t.label, type: 'service', group: nearestKept(t.parent, groupsById, isBoundary), tech: null, icon: null })
    }
  }
  for (const n of nodes) if (counts.has(n.id)) n.tech = `${counts.get(n.id)} component${counts.get(n.id) === 1 ? '' : 's'}`
  const groups = pruneGroups(model.groups.filter(isBoundary).map((g) => ({ ...g, parent: nearestKept(g.parent, groupsById, isBoundary) })), nodes)
  const edges = mergeEdges(model.edges.map((e) => ({ ...e, from: into.get(e.from), to: into.get(e.to) })))
  return { ...model, groups, nodes, edges }
}

/** Deployment: only boundaries (cloud, network, trust zone); logical tiers are dissolved. */
export function deployment(model) {
  const groupsById = new Map(model.groups.map((g) => [g.id, g]))
  const nodes = model.nodes.map((n) => ({ ...n, group: nearestKept(n.group, groupsById, isBoundary) }))
  const groups = pruneGroups(model.groups.filter(isBoundary).map((g) => ({ ...g, parent: nearestKept(g.parent, groupsById, isBoundary) })), nodes)
  return { ...model, groups, nodes }
}

/** Data flow: edges that touch a data store or carry async/bulk data, with trust boundaries only. */
export function dataflow(model) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const edges = model.edges.filter((e) => e.style !== 'sync'
    || DATA_TYPES.has(byId.get(e.from).type) || DATA_TYPES.has(byId.get(e.to).type))
  const ids = new Set(edges.flatMap((e) => [e.from, e.to]))
  const groupsById = new Map(model.groups.map((g) => [g.id, g]))
  const trust = (g) => g.kind === 'trust_zone'
  const nodes = model.nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n, group: nearestKept(n.group, groupsById, trust) }))
  const groups = pruneGroups(model.groups.filter(trust).map((g) => ({ ...g, parent: nearestKept(g.parent, groupsById, trust) })), nodes)
  return { ...model, groups, nodes, edges }
}

const DERIVE = { overview, deployment, dataflow }

/** The model to draw for a view ('sequence' and 'full' return the model unchanged). */
export function deriveModel(model, view) {
  return DERIVE[view] ? DERIVE[view](model) : model
}
