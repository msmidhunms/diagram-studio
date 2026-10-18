// Visual diff between two versions of a system model.
// diffModels returns one model containing everything from both versions, where each node,
// edge and group carries `diff: { status, changes }` (status: added | removed | changed |
// same). The Auto-layout renderer reads `diff` to colour the canvas; other code ignores it.

const NODE_FIELDS = ['label', 'type', 'group', 'tech', 'icon'] // same as backend diff_models
const EDGE_FIELDS = ['label', 'style']
const GROUP_FIELDS = ['label', 'kind', 'parent']

const edgeKey = (e) => `${e.from}->${e.to}`

function compare(before, after, fields) {
  return fields
    .filter((f) => (before[f] ?? null) !== (after[f] ?? null))
    .map((f) => ({ field: f, from: before[f] ?? null, to: after[f] ?? null }))
}

/** Merge two lists by key: items from `after` in order, then removed items from `before`. */
function union(before, after, key, fields) {
  const old = new Map(before.map((x) => [key(x), x]))
  const now = new Set(after.map(key))
  const merged = after.map((x) => {
    const prev = old.get(key(x))
    if (!prev) return { ...x, diff: { status: 'added', changes: [] } }
    const changes = compare(prev, x, fields)
    return { ...x, diff: { status: changes.length ? 'changed' : 'same', changes } }
  })
  for (const x of before) {
    if (!now.has(key(x))) merged.push({ ...x, diff: { status: 'removed', changes: [] } })
  }
  return merged
}

export function diffModels(before, after) {
  let groups = union(before.groups, after.groups, (g) => g.id, GROUP_FIELDS)
  let nodes = union(before.nodes, after.nodes, (n) => n.id, NODE_FIELDS)
  // an id that was a node in one version and a group in the other: keep the current one
  const currentIds = new Set([...after.nodes, ...after.groups].map((x) => x.id))
  const removedClash = (x) => x.diff.status === 'removed' && currentIds.has(x.id)
  nodes = nodes.filter((n) => !removedClash(n))
  groups = groups.filter((g) => !removedClash(g))
  const groupIds = new Set(groups.map((g) => g.id))
  groups = groups.map((g) => (g.parent && !groupIds.has(g.parent) ? { ...g, parent: null } : g))
  nodes = nodes.map((n) => (n.group && !groupIds.has(n.group) ? { ...n, group: null } : n))
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = union(before.edges, after.edges, edgeKey, EDGE_FIELDS)
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
  const model = { ...after, groups, nodes, edges }
  return { model, summary: summarize(model) }
}

function summarize(model) {
  const count = (list, status) => list.filter((x) => x.diff.status === status).length
  const out = {}
  for (const kind of ['nodes', 'edges', 'groups']) {
    out[kind] = { added: count(model[kind], 'added'), removed: count(model[kind], 'removed'), changed: count(model[kind], 'changed') }
  }
  out.identical = Object.values(out).every((c) => !c.added && !c.removed && !c.changed)
  return out
}

/** Human-readable tooltip for a changed item, e.g. "tech: Node.js → Go". */
export function describeChanges(changes) {
  return changes.map((c) => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join('\n')
}
