// Zoom math for the diagram viewport (kept free of React so it can be unit tested).
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const STEP = 1.25
const FIT_PADDING = 24 // px kept clear around a fitted diagram
const MAX_FIT = 2 // don't blow small diagrams up past 200% when fitting

export const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export const stepZoom = (z, dir) => clampZoom(dir > 0 ? z * STEP : z / STEP)

/** Largest zoom at which a w×h diagram fits fully inside a vw×vh viewport. */
export function fitZoom(w, h, vw, vh) {
  if (!(w > 0 && h > 0 && vw > 0 && vh > 0)) return 1
  const z = Math.min((vw - FIT_PADDING * 2) / w, (vh - FIT_PADDING * 2) / h, MAX_FIT)
  return clampZoom(z)
}

/** Scroll offsets that keep the content point under (px, py) fixed when zooming from z0 to z1. */
export function anchorScroll(scrollLeft, scrollTop, px, py, z0, z1) {
  const k = z1 / z0
  return { left: (scrollLeft + px) * k - px, top: (scrollTop + py) * k - py }
}
