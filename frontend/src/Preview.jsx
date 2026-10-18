import { useEffect, useState } from 'react'
import mermaid from 'mermaid'
import { modelToSvg } from './autolayout'
import ZoomView from './ZoomView'

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, flowchart: { htmlLabels: false } })

let counter = 0

// Turns a version into an SVG string for one of two views, then shows it in a zoomable viewport:
//   mermaid: the Mermaid code (parse errors go to onRenderError so the model can fix them)
//   svg:     the system model laid out with ELK; versions without a model show their stored SVG
export default function Preview({ view, code, model, onRenderError, onSvg }) {
  const [svg, setSvg] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const done = (out) => {
      if (cancelled) return
      setSvg(out)
      onSvg?.(out)
    }
    const fail = (e, report) => {
      if (cancelled) return
      const msg = String(e?.message || e)
      setError(msg)
      if (report) onRenderError?.(msg)
    }
    setError(null) // eslint-disable-line react-hooks/set-state-in-effect
    if (view === 'svg' && model) {
      modelToSvg(model).then(done).catch((e) => fail(e, false)) // our renderer: nothing for the model to repair
    } else if (view === 'mermaid') {
      const id = `m${++counter}`
      mermaid
        .render(id, code)
        .then(({ svg: out }) => done(out))
        .catch((e) => {
          document.getElementById(`d${id}`)?.remove()
          fail(e, true)
        })
    } else {
      done(code) // stored, server-sanitized SVG from before the system model existed
    }
    return () => {
      cancelled = true
    }
  }, [view, code, model]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="preview">
      {error ? <pre className="error">{error}</pre> : <ZoomView svg={svg} />}
    </div>
  )
}
