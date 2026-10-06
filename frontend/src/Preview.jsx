import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, flowchart: { htmlLabels: false } })

let counter = 0

// Renders Mermaid or (already server-sanitized) SVG. Mermaid parse errors are
// reported via onRenderError so the harness can ask the model to fix them.
export default function Preview({ format, code, onRenderError, onSvg }) {
  const ref = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (format !== 'mermaid') return
    let cancelled = false
    setError(null)
    mermaid
      .render(`m${++counter}`, code)
      .then(({ svg }) => {
        if (cancelled) return
        if (ref.current) ref.current.innerHTML = svg
        onSvg?.(svg)
      })
      .catch((e) => {
        document.getElementById(`dm${counter}`)?.remove()
        if (cancelled) return
        const msg = String(e?.message || e)
        setError(msg)
        onRenderError?.(msg)
      })
    return () => {
      cancelled = true
    }
  }, [format, code]) // eslint-disable-line react-hooks/exhaustive-deps

  if (format === 'svg') {
    // <img> sandboxes the SVG: no script execution even if sanitization missed something
    return (
      <div className="preview">
        <img alt="diagram" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(code)}`} />
      </div>
    )
  }
  return (
    <div className="preview">
      <div ref={ref} />
      {error && <pre className="error">{error}</pre>}
    </div>
  )
}
