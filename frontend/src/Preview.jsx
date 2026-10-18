import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { modelToSvg } from './autolayout'

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, flowchart: { htmlLabels: false } })

let counter = 0

const svgImg = (svg) => (
  // <img> sandboxes the SVG: no script execution even if something slipped through
  <img alt="diagram" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
)

// Renders a version in one of two views:
//   mermaid: the Mermaid code (parse errors go to onRenderError so the model can fix them)
//   svg:     the system model laid out with ELK; versions without a model show their stored SVG
export default function Preview({ view, code, model, onRenderError, onSvg }) {
  const ref = useRef(null)
  const [error, setError] = useState(null)
  const [layoutSvg, setLayoutSvg] = useState(null)

  useEffect(() => {
    let cancelled = false
    const fail = (e, report) => {
      if (cancelled) return
      const msg = String(e?.message || e)
      setError(msg)
      if (report) onRenderError?.(msg)
    }
    setError(null) // eslint-disable-line react-hooks/set-state-in-effect
    if (view === 'svg' && model) {
      modelToSvg(model)
        .then((svg) => {
          if (cancelled) return
          setLayoutSvg(svg)
          onSvg?.(svg)
        })
        .catch((e) => fail(e, false)) // our renderer, not the model's output: nothing to repair
    } else if (view === 'mermaid') {
      mermaid
        .render(`m${++counter}`, code)
        .then(({ svg }) => {
          if (cancelled) return
          if (ref.current) ref.current.innerHTML = svg
          onSvg?.(svg)
        })
        .catch((e) => {
          document.getElementById(`dm${counter}`)?.remove()
          fail(e, true)
        })
    } else {
      onSvg?.(code) // stored, server-sanitized SVG from before the system model existed
    }
    return () => {
      cancelled = true
    }
  }, [view, code, model]) // eslint-disable-line react-hooks/exhaustive-deps

  let body
  if (view === 'mermaid') body = <div ref={ref} />
  else if (model) body = layoutSvg && svgImg(layoutSvg)
  else body = svgImg(code)
  return (
    <div className="preview">
      {body}
      {error && <pre className="error">{error}</pre>}
    </div>
  )
}
