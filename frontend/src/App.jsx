import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import Preview from './Preview'
import { downloadPng, downloadSvg, downloadText } from './exportFile'
import { MODEL_EXPORTS } from './exporters'
import { toMermaid, toMermaidSequence } from './exporters/mermaid'
import { VIEWS, deriveModel } from './views'

const MAX_AUTO_REPAIRS = 2

function Review({ review }) {
  if (!review) return null
  const revised = review.revisions ? ` · revised ${review.revisions}×` : ''
  const verdict = review.approved ? 'approved' : 'has open issues'
  return (
    <details className="review">
      <summary>
        Critic: <strong className={review.approved ? 'added' : 'changed'}>{review.score}/10, {verdict}</strong>{revised}
        {review.summary && <span className="muted"> — {review.summary}</span>}
      </summary>
      {review.issues.length ? (
        <ul>
          {review.issues.map((i, n) => (
            <li key={n} className={i.severity}>
              <span className="severity">{i.severity}</span>
              {i.target && <code>{i.target}</code>} {i.problem}
              {i.fix && <span className="muted"> → {i.fix}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="muted">No issues found.</p>}
    </details>
  )
}

function Changes({ changes }) {
  if (!changes) return null
  const parts = [
    ['+', changes.added_nodes, 'added'],
    ['−', changes.removed_nodes, 'removed'],
    ['~', changes.changed_nodes, 'changed'],
  ].filter(([, list]) => list.length)
  const edges = changes.added_edges.length + changes.removed_edges.length
  if (!parts.length && !edges) return <p className="changes muted">No component changes from the previous version.</p>
  return (
    <p className="changes">
      {parts.map(([sign, list, cls]) => (
        <span key={cls} className={cls}>{sign} {list.join(', ')}</span>
      ))}
      {edges > 0 && (
        <span className="muted">
          {changes.added_edges.length} connection{changes.added_edges.length === 1 ? '' : 's'} added,{' '}
          {changes.removed_edges.length} removed
        </span>
      )}
    </p>
  )
}

// Every version with the prompt that produced it; click to view that version.
function History({ versions, selected, onSelect }) {
  return (
    <details className="history" open>
      <summary>History ({versions.length})</summary>
      <ol>
        {versions.map((v, i) => {
          const auto = v.prompt.startsWith('(auto-repair)')
          return (
            <li key={v.number}>
              <button className={i === selected ? 'active' : ''} onClick={() => onSelect(i)} aria-current={i === selected}>
                <span className="v">v{v.number}</span>
                <span className={auto ? 'prompt muted' : 'prompt'}>
                  {auto ? `Auto-fix: ${v.prompt.replace('(auto-repair) ', '')}` : v.prompt}
                </span>
                <time dateTime={v.created_at}>{new Date(v.created_at).toLocaleString()}</time>
              </button>
            </li>
          )
        })}
      </ol>
    </details>
  )
}

export default function App() {
  const [diagrams, setDiagrams] = useState([])
  const [current, setCurrent] = useState(null)
  const [versionIdx, setVersionIdx] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [format, setFormat] = useState('svg')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [renderedSvg, setRenderedSvg] = useState(null)
  const [view, setView] = useState('mermaid') // renderer: 'svg' (Auto-layout) or 'mermaid'
  const [perspective, setPerspective] = useState('full') // which view of the system, see views.js
  const [confirmDelete, setConfirmDelete] = useState(false)
  const repairs = useRef(0)

  const refresh = useCallback(() => api.listDiagrams().then(setDiagrams).catch((e) => setError(e.message)), [])
  useEffect(() => { refresh() }, [refresh])

  const show = (d) => {
    setCurrent(d)
    setVersionIdx(d.versions.length - 1)
    setView(d.format)
    setPerspective('full')
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
    run('Generating and reviewing…', () => api.generate({ prompt, format, diagram_id: current?.id }))
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
  const svgForExport = renderedSvg
  // versions made before the system model existed can only show the format they were made in
  const activeView = version?.model ? view : current?.format
  const hasMermaid = version && (version.model || current.format === 'mermaid')
  const isLatest = current && versionIdx === current.versions.length - 1

  // Views other than Full are derived in the browser and rendered with the JS Mermaid port;
  // the sequence view only exists as Mermaid.
  const isFull = !version?.model || perspective === 'full'
  const isSequence = !isFull && perspective === 'sequence'
  const viewModel = useMemo(
    () => (version?.model ? deriveModel(version.model, perspective) : null), [version, perspective])
  const previewView = isSequence ? 'mermaid' : activeView
  const previewCode = useMemo(() => {
    if (isFull) return version?.code
    return isSequence ? toMermaidSequence(version.model) : toMermaid(viewModel)
  }, [isFull, isSequence, version, viewModel])
  const viewLabel = VIEWS.find((v) => v.id === perspective)?.label
  const fileTitle = (suffix) => [current.title, isFull ? null : viewLabel, suffix].filter(Boolean).join(' ')

  const exportAs = async (id) => {
    if (id === 'mermaid') return downloadText(previewCode, fileTitle(), 'mmd', 'text/plain')
    const f = MODEL_EXPORTS.find((x) => x.id === id)
    try {
      const text = await f.build(viewModel, current.title)
      downloadText(text, fileTitle(f.suffix), f.ext, f.mime)
    } catch (e) {
      setError(`Export failed: ${e.message}`)
    }
  }

  const onRenderError = useCallback((msg) => {
    // only the stored Mermaid comes from the model; derived views are our own rendering
    if (!isFull || !isLatest || busy || repairs.current >= MAX_AUTO_REPAIRS) return
    repairs.current += 1
    run(`Fixing syntax (attempt ${repairs.current})…`, () => api.repair(current.id, msg))
  }, [isFull, isLatest, busy, current]) // eslint-disable-line react-hooks/exhaustive-deps

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
              {version.model && (
                <select value={previewView} disabled={isSequence} onChange={(e) => { setRenderedSvg(null); setView(e.target.value) }} title="Renderer">
                  <option value="svg">Auto-layout</option>
                  <option value="mermaid">Mermaid</option>
                </select>
              )}
              <select value={versionIdx} onChange={(e) => { setRenderedSvg(null); setVersionIdx(Number(e.target.value)) }}>
                {current.versions.map((v, i) => (
                  <option key={v.number} value={i}>v{v.number}{v.repairs ? ` (${v.repairs} repair)` : ''}</option>
                ))}
              </select>
              </div>
            </header>
            <Changes changes={version.changes} />
            {version.model && (
              <div className="views" role="tablist" aria-label="View">
                {VIEWS.map((v) => (
                  <button key={v.id} role="tab" aria-selected={perspective === v.id} title={v.hint}
                    className={perspective === v.id ? 'on' : ''}
                    onClick={() => { setRenderedSvg(null); setPerspective(v.id) }}>
                    {v.label}
                  </button>
                ))}
                {isSequence && <span className="muted">Order inferred from connections</span>}
              </div>
            )}
            {viewModel && !viewModel.nodes.length ? (
              <p className="preview empty-view muted">Nothing to show in this view: {VIEWS.find((v) => v.id === perspective).hint.toLowerCase()}.</p>
            ) : (
              <Preview view={previewView} code={previewCode} model={viewModel} onRenderError={onRenderError} onSvg={setRenderedSvg} />
            )}
            <div className="actions export">
              <span className="muted">Export:</span>
              <button disabled={!svgForExport} onClick={() => downloadSvg(svgForExport, fileTitle())}>SVG</button>
              <button disabled={!svgForExport} onClick={() => downloadPng(svgForExport, fileTitle())}>PNG</button>
              {(hasMermaid || version.model) && (
                <select value="" onChange={(e) => exportAs(e.target.value)} aria-label="Export as another format">
                  <option value="" disabled>More formats…</option>
                  {hasMermaid && <option value="mermaid">Mermaid (.mmd)</option>}
                  {version.model && !isSequence && MODEL_EXPORTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              )}
            </div>
            <p className="explain">{version.explanation}</p>
            <Review review={version.review} />
            <History
              versions={current.versions}
              selected={versionIdx}
              onSelect={(i) => { setRenderedSvg(null); setVersionIdx(i) }}
            />
            <details>
              <summary>Source</summary>
              <pre>{version.code}</pre>
            </details>
            {version.model && (
              <details>
                <summary>System model</summary>
                <pre>{JSON.stringify(version.model, null, 2)}</pre>
              </details>
            )}
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
              <option value="svg">Auto-layout</option>
              <option value="mermaid">Mermaid</option>
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
