// System model -> Excalidraw scene (.excalidraw JSON), positioned with the ELK layout.
// Excalidraw only has rectangles, ellipses and diamonds, so node types map to the closest
// shape plus the shared colour palette.
import { DEFAULT_COLORS, EDGE_STYLES, GROUP_STYLES, NODE_COLORS, layoutModel } from '../autolayout'
import { gid, hash, nid } from './common'

const FONT = 2 // Excalidraw "Normal" (Helvetica)
const LINE_HEIGHT = 1.25

function base(id, type, x, y, width, height, extra = {}) {
  return {
    id, type, x, y, width, height, angle: 0,
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 1.5, strokeStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null,
    seed: hash(id) % 2 ** 31, version: 1, versionNonce: hash(`${id}:v`) % 2 ** 31,
    isDeleted: false, boundElements: [], updated: 1, link: null, locked: false,
    ...extra,
  }
}

function text(id, str, x, y, width, size, extra = {}) {
  const lines = str.split('\n').length
  return base(id, 'text', x, y, width, lines * size * LINE_HEIGHT, {
    text: str, originalText: str, fontSize: size, fontFamily: FONT,
    textAlign: 'center', verticalAlign: 'middle', containerId: null,
    lineHeight: LINE_HEIGHT, autoResize: true, strokeColor: '#1f2328', ...extra,
  })
}

export async function toExcalidraw(model) {
  const { shapes, laid } = await layoutModel(model)
  const elements = []
  const byId = new Map()
  const add = (el) => { elements.push(el); byId.set(el.id, el); return el }

  const depth = (g) => (g.parent ? 1 + depth(model.groups.find((p) => p.id === g.parent)) : 0)
  for (const g of [...model.groups].sort((a, b) => depth(a) - depth(b))) {
    const b = shapes.get(gid(g.id))
    const st = GROUP_STYLES[g.kind] || GROUP_STYLES.other
    add(base(gid(g.id), 'rectangle', b.x, b.y, b.width, b.height, {
      strokeColor: st.stroke, backgroundColor: st.fill === 'none' ? 'transparent' : st.fill,
      strokeStyle: st.dash ? 'dashed' : 'solid', strokeWidth: st.width || 1, roundness: { type: 3 },
    }))
    add(text(`${gid(g.id)}_label`, g.label, b.x + 14, b.y + 10, g.label.length * 8 + 4, 14, {
      textAlign: 'left', verticalAlign: 'top', strokeColor: st.text,
    }))
  }

  for (const n of model.nodes) {
    const b = shapes.get(nid(n.id))
    const [fill, stroke] = NODE_COLORS[n.type] || DEFAULT_COLORS
    const round = n.type === 'user' || n.type === 'client'
    const shape = add(base(nid(n.id), round ? 'ellipse' : 'rectangle', b.x, b.y, b.width, b.height, {
      strokeColor: stroke, backgroundColor: fill, roundness: round ? { type: 2 } : { type: 3 },
      strokeStyle: n.type === 'external' ? 'dashed' : 'solid',
    }))
    const label = n.tech ? `${n.label}\n${n.tech}` : n.label
    const t = text(`${nid(n.id)}_text`, label, b.x + 8, 0, b.width - 16, 14, { containerId: shape.id })
    t.y = b.y + (b.height - t.height) / 2
    shape.boundElements.push({ type: 'text', id: t.id })
    add(t)
  }

  model.edges.forEach((e, i) => {
    const sec = laid.edges.find((x) => x.id === `e${i}`)?.sections?.[0]
    if (!sec) return
    const st = EDGE_STYLES[e.style] || EDGE_STYLES.sync
    const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint]
    const x0 = pts[0].x
    const y0 = pts[0].y
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const arrow = add(base(`e${i}`, 'arrow', x0, y0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
      strokeColor: st.stroke, strokeWidth: st.width, strokeStyle: st.dash ? 'dashed' : 'solid',
      points: pts.map((p) => [p.x - x0, p.y - y0]), lastCommittedPoint: null,
      startBinding: { elementId: nid(e.from), focus: 0, gap: 1 },
      endBinding: { elementId: nid(e.to), focus: 0, gap: 1 },
      startArrowhead: null, endArrowhead: 'arrow', elbowed: false,
    }))
    byId.get(nid(e.from)).boundElements.push({ type: 'arrow', id: arrow.id })
    byId.get(nid(e.to)).boundElements.push({ type: 'arrow', id: arrow.id })
    if (e.label) {
      // initial position only: Excalidraw re-centres arrow-bound labels itself
      const mid = pts[Math.floor((pts.length - 1) / 2)]
      const next = pts[Math.floor((pts.length - 1) / 2) + 1]
      const w = e.label.length * 7 + 8
      const t = text(`e${i}_text`, e.label, (mid.x + next.x) / 2 - w / 2, (mid.y + next.y) / 2 - 8, w, 12, {
        containerId: arrow.id, strokeColor: '#57606a',
      })
      arrow.boundElements.push({ type: 'text', id: t.id })
      add(t)
    }
  })

  return JSON.stringify({
    type: 'excalidraw', version: 2, source: 'diagram-studio', elements,
    appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {},
  }, null, 2) + '\n'
}
