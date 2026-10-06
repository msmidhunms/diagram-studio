function save(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const slug = (t) => (t || 'diagram').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram'

export function downloadText(text, title, ext, type) {
  save(new Blob([text], { type }), `${slug(title)}.${ext}`)
}

export function downloadSvg(svg, title) {
  downloadText(svg, title, 'svg', 'image/svg+xml')
}

function svgSize(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  const vb = (doc.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return [vb[2], vb[3]]
  const w = parseFloat(doc.getAttribute('width')), h = parseFloat(doc.getAttribute('height'))
  return [w > 0 ? w : 960, h > 0 ? h : 600]
}

export function downloadPng(svg, title, scale = 2) {
  const [w, h] = svgSize(svg)
  // pin explicit pixel size so the <img> rasterizes at the right dimensions
  const sized = svg.replace(/<svg([^>]*)>/, (m, attrs) =>
    `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${w}" height="${h}">`)
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = w * scale
    canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((b) => save(b, `${slug(title)}.png`), 'image/png')
  }
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`
}
