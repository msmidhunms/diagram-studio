import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from './api'
import Preview from './Preview'
import { downloadPng, downloadSvg, downloadText } from './exportFile'

const MAX_AUTO_REPAIRS = 2

export default function App() {
  const [diagrams, setDiagrams] = useState([])
  const [current, setCurrent] = useState(null)
  const [versionIdx, setVersionIdx] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [format, setFormat] = useState('mermaid')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [renderedSvg, setRenderedSvg] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const repairs = useRef(0)

  const refresh = useCallback(() => api.listDiagrams().then(setDiagrams).catch((e) => setError(e.message)), [])
  useEffect(() => { refresh() }, [refresh])

  const show = (d) => {
    setCurrent(d)
    setVersionIdx(d.versions.length - 1)
    repairs.current = 0
    setRenderedSvg(null)
    setConfirmDelete(false)
    refresh()
  }

  const run = async (label, fn) => {
    setBusy(label)
    setError(null)
    try { show(await fn()) } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  const submit = (e) => {
    e.preventDefault()
    if (!prompt.trim() || busy) return
    run('Generating…', () => api.generate({ prompt, format, diagram_id: current?.id }))
    setPrompt('')
  }

  const rename = async () => {
    const title = window.prompt('Rename diagram', current.title)?.trim()
    if (!title || title === current.title) return
    try { show(await api.renameDiagram(current.id, title)) } catch (e) { setError(e.message) }
  }

  const remove = async () => {
    try {
      await api.deleteDiagram(current.id)
      setCurrent(null)
      setConfirmDelete(false)
      refresh()
    } catch (e) { setError(e.message) }
  }

  const open = (id) => api.getDiagram(id).then(show).catch((e) => setError(e.message))

  const version = current?.versions[versionIdx]
  const svgForExport = current?.format === 'svg' ? version?.code : renderedSvg
  const isLatest = current && versionIdx === current.versions.length - 1

  const onRenderError = useCallback((msg) => {
    if (!isLatest || busy || repairs.current >= MAX_AUTO_REPAIRS) return
    repairs.current += 1
    run(`Fixing syntax (attempt ${repairs.current})…`, () => api.repair(current.id, msg))
  }, [isLatest, busy, current]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <aside>
        <h1>Diagram Studio</h1>
        <button onClick={() => { setCurrent(null); setError(null) }}>+ New diagram</button>
        <ul>
          {diagrams.map((d) => (
            <li key={d.id}>
              <button className={current?.id === d.id ? 'active' : ''} onClick={() => open(d.id)}>
                {d.title || `Diagram ${d.id}`} <small>{d.format}</small>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main>
        {version ? (
          <>
            <header>
              <h2>{current.title}</h2>
              <div className="actions">
              <button onClick={rename}>Rename</button>
              {confirmDelete ? (
                <>
                  <button className="danger" onClick={remove}>Confirm delete</button>
                  <button onClick={() => setConfirmDelete(false)}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setConfirmDelete(true)}>Delete</button>
              )}
              <select value={versionIdx} onChange={(e) => setVersionIdx(Number(e.target.value))}>
                {current.versions.map((v, i) => (
                  <option key={v.number} value={i}>v{v.number}{v.repairs ? ` (${v.repairs} repair)` : ''}</option>
                ))}
              </select>
              </div>
            </header>
            <Preview format={current.format} code={version.code} onRenderError={onRenderError} onSvg={setRenderedSvg} />
            <div className="actions export">
              <span className="muted">Export:</span>
              <button disabled={!svgForExport} onClick={() => downloadSvg(svgForExport, current.title)}>SVG</button>
              <button disabled={!svgForExport} onClick={() => downloadPng(svgForExport, current.title)}>PNG</button>
              {current.format === 'mermaid' && (
                <button onClick={() => downloadText(version.code, current.title, 'mmd', 'text/plain')}>Mermaid (.mmd)</button>
              )}
            </div>
            <p className="explain">{version.explanation}</p>
            <details>
              <summary>Source</summary>
              <pre>{version.code}</pre>
            </details>
            {!isLatest && <p className="muted">Viewing an older version — edits apply to the latest.</p>}
          </>
        ) : (
          <div className="empty">
            <p>Describe a system and get an architecture diagram.</p>
            <p className="muted">e.g. “Web app with React frontend, Django API, Postgres, Redis cache and a Celery worker”</p>
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {busy && <p className="muted">{busy}</p>}

        <form onSubmit={submit}>
          {!current && (
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="mermaid">Mermaid</option>
              <option value="svg">SVG</option>
            </select>
          )}
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={current ? 'Describe a change…' : 'Describe your system…'}
            disabled={!!busy}
          />
          <button disabled={!!busy || !prompt.trim()}>{current ? 'Update' : 'Generate'}</button>
        </form>
      </main>
    </div>
  )
}
