import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { svgSize } from './exportFile'
import { anchorScroll, fitZoom, stepZoom } from './zoom'

// Scrollable, zoomable viewport for an SVG string.
// Zoom: toolbar buttons, Ctrl/⌘ + wheel (around the cursor), keys + - 0 (fit) 1 (100%).
// Pan: drag with the mouse, or scroll.
export default function ZoomView({ svg }) {
  const viewport = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true) // auto-fit until the user zooms manually
  const anchor = useRef(null) // pending scroll adjustment after a zoom-around-point
  const drag = useRef(null)
  const [w, h] = svg ? svgSize(svg) : [0, 0]

  const doFit = useCallback(() => {
    const el = viewport.current
    if (el && w) setZoom(fitZoom(w, h, el.clientWidth, el.clientHeight))
  }, [w, h])

  // refit when the diagram changes or the viewport resizes, while in fit mode
  useLayoutEffect(() => {
    if (!fit) return
    doFit()
    const ro = new ResizeObserver(doFit)
    ro.observe(viewport.current)
    return () => ro.disconnect()
  }, [fit, doFit])

  useLayoutEffect(() => {
    const el = viewport.current
    if (!anchor.current || !el) return
    el.scrollLeft = anchor.current.left
    el.scrollTop = anchor.current.top
    anchor.current = null
  }, [zoom])

  // zoom keeping a viewport point (default: centre) fixed on screen
  const zoomTo = useCallback((next, px, py) => {
    const el = viewport.current
    setFit(false)
    setZoom((z) => {
      const z1 = typeof next === 'function' ? next(z) : next
      if (el) {
        const x = px ?? el.clientWidth / 2
        const y = py ?? el.clientHeight / 2
        anchor.current = anchorScroll(el.scrollLeft, el.scrollTop, x, y, z, z1)
      }
      return z1
    })
  }, [])

  // Ctrl/⌘ + wheel (and trackpad pinch, which browsers report as ctrl+wheel) zooms;
  // registered manually because React's onWheel is passive and can't preventDefault
  useEffect(() => {
    const el = viewport.current
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomTo((z) => stepZoom(z, e.deltaY < 0 ? 1 : -1), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo])

  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === '+' || e.key === '=') zoomTo((z) => stepZoom(z, 1))
    else if (e.key === '-' || e.key === '_') zoomTo((z) => stepZoom(z, -1))
    else if (e.key === '0') setFit(true)
    else if (e.key === '1') zoomTo(1)
    else return
    e.preventDefault()
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    const el = viewport.current
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    viewport.current.scrollLeft = d.left - (e.clientX - d.x)
    viewport.current.scrollTop = d.top - (e.clientY - d.y)
  }
  const endDrag = () => { drag.current = null }

  return (
    <div className="zoom">
      <div className="zoom-toolbar" role="toolbar" aria-label="Zoom">
        <button type="button" onClick={() => zoomTo((z) => stepZoom(z, -1))} title="Zoom out (−)" aria-label="Zoom out">−</button>
        <span className="zoom-level" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomTo((z) => stepZoom(z, 1))} title="Zoom in (+)" aria-label="Zoom in">+</button>
        <button type="button" className={fit ? 'on' : ''} onClick={() => setFit(true)} title="Fit to screen (0)">Fit</button>
        <button type="button" onClick={() => zoomTo(1)} title="Actual size (1)">100%</button>
      </div>
      <div
        ref={viewport}
        className="zoom-viewport"
        tabIndex={0}
        aria-label="Diagram. Drag to pan, Ctrl or Command plus scroll to zoom."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {svg && (
          // <img> sandboxes the SVG: no script execution even if something slipped through
          <img
            alt="diagram"
            draggable={false}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            style={{ width: w * zoom, height: h * zoom }}
          />
        )}
      </div>
    </div>
  )
}
