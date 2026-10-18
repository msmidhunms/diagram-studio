// System model -> draw.io / diagrams.net file (uncompressed mxGraph XML), positioned with
// the same ELK layout as the Auto-layout view so it opens looking the same.
import { DEFAULT_COLORS, EDGE_STYLES, GROUP_STYLES, NODE_COLORS, layoutModel } from '../autolayout'
import { escXml, gid, nid } from './common'

const SHAPE = {
  database: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=8;',
  storage: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=8;',
  cache: 'shape=hexagon;perimeter=hexagonPerimeter2;size=0.1;fixedSize=0;',
  queue: 'shape=process;backgroundOutline=1;size=0.06;',
  client: 'rounded=1;arcSize=50;',
  user: 'rounded=1;arcSize=50;',
  external: 'rounded=1;dashed=1;',
  gateway: 'shape=parallelogram;perimeter=parallelogramPerimeter;size=0.06;fixedSize=0;',
  function: 'rounded=1;arcSize=30;',
}

const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const r = (v) => Math.round(v)

export async function toDrawio(model, title = 'Diagram') {
  const { shapes, laid } = await layoutModel(model)
  const abs = (id) => shapes.get(id)
  const parentOf = (g) => (g ? gid(g) : '1')
  // draw.io child geometry is relative to the parent container
  const rel = (box, parentGroup) => {
    const p = parentGroup ? abs(gid(parentGroup)) : { x: 0, y: 0 }
    return `<mxGeometry x="${r(box.x - p.x)}" y="${r(box.y - p.y)}" width="${r(box.width)}" height="${r(box.height)}" as="geometry"/>`
  }
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']

  // parents must come before children
  const depth = (g) => (g.parent ? 1 + depth(model.groups.find((p) => p.id === g.parent)) : 0)
  for (const g of [...model.groups].sort((a, b) => depth(a) - depth(b))) {
    const st = GROUP_STYLES[g.kind] || GROUP_STYLES.other
    const style = `rounded=1;arcSize=3;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;` +
      `verticalAlign=top;align=left;spacingLeft=10;spacingTop=2;fontStyle=1;fontSize=12;` +
      `fillColor=${st.fill};strokeColor=${st.stroke};fontColor=${st.text};strokeWidth=${st.width || 1};` +
      (st.dash ? 'dashed=1;' : '')
    cells.push(`<mxCell id="${gid(g.id)}" value="${escXml(escHtml(g.label))}" style="${style}" vertex="1" parent="${parentOf(g.parent)}">` +
      `${rel(abs(gid(g.id)), g.parent)}</mxCell>`)
  }

  for (const n of model.nodes) {
    const [fill, stroke] = NODE_COLORS[n.type] || DEFAULT_COLORS
    const style = `${SHAPE[n.type] || 'rounded=1;'}whiteSpace=wrap;html=1;fontStyle=0;fontSize=13;fillColor=${fill};strokeColor=${stroke};`
    const label = `<b>${escHtml(n.label)}</b>` +
      (n.tech ? `<br><font style="font-size:11px" color="#57606a">${escHtml(n.tech)}</font>` : '')
    cells.push(`<mxCell id="${nid(n.id)}" value="${escXml(label)}" style="${style}" vertex="1" parent="${parentOf(n.group)}">` +
      `${rel(abs(nid(n.id)), n.group)}</mxCell>`)
  }

  model.edges.forEach((e, i) => {
    const st = EDGE_STYLES[e.style] || EDGE_STYLES.sync
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;fontSize=11;` +
      `strokeColor=${st.stroke};strokeWidth=${st.width};labelBackgroundColor=#ffffff;` + (st.dash ? 'dashed=1;' : '')
    // edges live on the root layer, so ELK's absolute bend points can be used as-is
    const bends = (laid.edges.find((x) => x.id === `e${i}`)?.sections?.[0]?.bendPoints || []).map((p) => `<mxPoint x="${r(p.x)}" y="${r(p.y)}"/>`).join('')
    cells.push(`<mxCell id="e${i}" value="${escXml(escHtml(e.label || ''))}" style="${style}" edge="1" parent="1" ` +
      `source="${nid(e.from)}" target="${nid(e.to)}"><mxGeometry relative="1" as="geometry">` +
      `${bends ? `<Array as="points">${bends}</Array>` : ''}</mxGeometry></mxCell>`)
  })

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<mxfile host="diagram-studio"><diagram id="architecture" name="${escXml(title)}">` +
    '<mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root>' +
    cells.join('') + '</root></mxGraphModel></diagram></mxfile>\n'
}
