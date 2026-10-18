import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import Preview from './Preview'
import { downloadPng, downloadSvg, downloadText } from './exportFile'
import { MODEL_EXPORTS } from './exporters'
import { toMermaid, toMermaidSequence } from './exporters/mermaid'
import { VIEWS, deriveModel } from './views'
import { DIFF_STYLES } from './autolayout'
import { diffModels } from './diff'

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

// Questions the clarifier asks before drawing a new diagram from a vague request
function Clarify({ request, busy, onAnswer, onSkip, onEdit }) {
  const [answers, setAnswers] = useState({}) // question index -> answer text
  const [custom, setCustom] = useState({}) // question index -> typed "other" answer
  const answered = request.questions.map((q, i) => (custom[i]?.trim() || answers[i] || '')).filter(Boolean).length
  const submit = (e) => {
    e.preventDefault()
    onAnswer(request.questions.map((q, i) => ({ question: q.question, answer: custom[i]?.trim() || answers[i] || '' }))
      .filter((a) => a.answer))
  }
  return (
    <form className="clarify" onSubmit={submit}>
      <h3>A few questions first</h3>
      <p className="muted">“{request.prompt}” could be drawn several ways. Answer what you can; anything left blank uses a sensible default.</p>
      {request.questions.map((q, i) => (
        <fieldset key={i}>
          <legend>{q.question}</legend>
          <div className="options">
            {q.options.map((o) => (
              <button type="button" key={o} aria-pressed={answers[i] === o && !custom[i]?.trim()}
                className={answers[i] === o && !custom[i]?.trim() ? 'on' : ''}
                onClick={() => { setAnswers({ ...answers, [i]: answers[i] === o ? '' : o }); setCustom({ ...custom, [i]: '' }) }}>
                {o}
              </button>
            ))}
            <input placeholder="Other…" value={custom[i] || ''} aria-label={`Other answer: ${q.question}`}
              onChange={(e) => setCustom({ ...custom, [i]: e.target.value })} />
          </div>
        </fieldset>
      ))}
      <div className="actions">
        <button className="primary" disabled={busy || !answered}>Generate diagram</button>
        <button type="button" disabled={busy} onClick={onSkip}>Skip, use defaults</button>
        <button type="button" disabled={busy} onClick={onEdit}>Edit request</button>
      </div>
    </form>
  )
}

// Legend and counts while comparing two versions on the canvas
function CompareLegend({ summary, from, to }) {
  const part = (c, noun) => {
    const bits = [['added', '+'], ['removed', '−'], ['changed', '~']].filter(([k]) => c[k]).map(([k, sign]) => (
      <span key={k} style={{ color: DIFF_STYLES[k].color }}>{sign}{c[k]}</span>
    ))
    return bits.length ? <span className="legend-part">{noun} {bits}</span> : null
  }
  return (
    <p className="changes compare-legend">
      <strong>v{to} compared with v{from}:</strong>
      {summary.identical ? <span className="muted">no differences in this view</span> : (
        <>
          {part(summary.nodes, 'components')}
          {part(summary.edges, 'connections')}
          {part(summary.groups, 'groups')}
          <span className="muted">
            {Object.entries(DIFF_STYLES).map(([k, st]) => (
              <span key={k} className="swatch"><i style={{ background: st.color }} />{st.title.toLowerCase()}</span>
            ))}
          </span>
        </>
      )}
    </p>
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
  const [compareIdx, setCompareIdx] = useState(null) // version index to diff against, or null
  const [clarify, setClarify] = useState(null) // {prompt, format, questions} while asking
  const [confirmDelete, setConfirmDelete] = useState(false)
  const repairs = useRef(0)
  const promptInput = useRef(null)

  const refresh = useCallback(() => api.listDiagrams().then(setDiagrams).catch((e) => setError(e.message)), [])
  useEffect(() => { refresh() }, [refresh])

  const show = (d) => {
    setCurrent(d)
    setVersionIdx(d.versions.length - 1)
    setView(d.format)
    setPerspective('full')
    setCompareIdx(null)
    setClarify(null)
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

  // New diagram: the backend may answer with clarifying questions instead of a diagram
  const generateNew = async (body, label) => {
    setBusy(label)
    setError(null)
    try {
      const r = await api.generate(body)
      if (r.needs_clarification) setClarify({ prompt: r.prompt, format: body.format, questions: r.questions })
      else show(r)
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  const submit = (e) => {
    e.preventDefault()
    if (!prompt.trim() || busy) return
    if (current) run('Generating and reviewing…', () => api.generate({ prompt, diagram_id: current.id }))
    else generateNew({ prompt, format }, 'Reading your request…')
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
  // Compare mode: the selected view of both versions, merged into one diff model (diff.js)
  const compareVersion = compareIdx !== null && compareIdx !== versionIdx ? current?.versions[compareIdx] : null
  const comparing = Boolean(compareVersion?.model && viewModel && !isSequence)
  const diff = useMemo(
    () => (comparing ? diffModels(deriveModel(compareVersion.model, perspective), viewModel) : null),
    [comparing, compareVersion, perspective, viewModel])
  const previewView = isSequence ? 'mermaid' : comparing ? 'svg' : activeView
  const previewCode = useMemo(() => {
    if (isFull) return version?.code
    return isSequence ? toMermaidSequence(version.model) : toMermaid(viewModel)
  }, [isFull, isSequence, version, viewModel])
  const viewLabel = VIEWS.find((v) => v.id === perspective)?.label
  const fileTitle = (suffix) => [current.title, isFull ? null : viewLabel,
    comparing ? `v${version.number} vs v${compareVersion.number}` : null, suffix].filter(Boolean).join(' ')
  const selectVersion = (i) => {
    setRenderedSvg(null)
    setVersionIdx(i)
    if (i === compareIdx) setCompareIdx(null)
  }

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
    if (!isFull || comparing || !isLatest || busy || repairs.current >= MAX_AUTO_REPAIRS) return
    repairs.current += 1
    run(`Fixing syntax (attempt ${repairs.current})…`, () => api.repair(current.id, msg))
  }, [isFull, comparing, isLatest, busy, current]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <aside>
        <h1>Diagram Studio</h1>
        <button onClick={() => { setCurrent(null); setError(null); setClarify(null) }}>+ New diagram</button>
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
                <select value={previewView} disabled={isSequence || comparing} onChange={(e) => { setRenderedSvg(null); setView(e.target.value) }} title="Renderer">
                  <option value="svg">Auto-layout</option>
                  <option value="mermaid">Mermaid</option>
                </select>
              )}
              <select value={versionIdx} onChange={(e) => selectVersion(Number(e.target.value))} title="Version">
                {current.versions.map((v, i) => (
                  <option key={v.number} value={i}>v{v.number}{v.repairs ? ` (${v.repairs} repair)` : ''}</option>
                ))}
              </select>
              {version.model && current.versions.filter((v) => v.model).length > 1 && (
                <select
                  value={compareVersion ? compareIdx : ''}
                  title="Compare with another version"
                  onChange={(e) => {
                    setRenderedSvg(null)
                    setCompareIdx(e.target.value === '' ? null : Number(e.target.value))
                    if (perspective === 'sequence') setPerspective('full')
                  }}
                >
                  <option value="">Compare: off</option>
                  {current.versions.map((v, i) => (i !== versionIdx && v.model
                    ? <option key={v.number} value={i}>Compare with v{v.number}</option> : null))}
                </select>
              )}
              </div>
            </header>
            {comparing
              ? <CompareLegend summary={diff.summary} from={compareVersion.number} to={version.number} />
              : <Changes changes={version.changes} />}
            {version.model && (
              <div className="views" role="tablist" aria-label="View">
                {VIEWS.map((v) => (
                  <button key={v.id} role="tab" aria-selected={perspective === v.id} title={v.hint}
                    disabled={compareVersion && v.id === 'sequence'}
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
              <Preview view={previewView} code={previewCode} model={comparing ? diff.model : viewModel}
                onRenderError={onRenderError} onSvg={setRenderedSvg} />
            )}
            <div className="actions export">
              <span className="muted">Export:</span>
              <button disabled={!svgForExport} onClick={() => downloadSvg(svgForExport, fileTitle())}>SVG</button>
              <button disabled={!svgForExport} onClick={() => downloadPng(svgForExport, fileTitle())}>PNG</button>
              {(hasMermaid || version.model) && (
                <select value="" disabled={comparing} title={comparing ? 'Turn off compare to export other formats' : undefined} onChange={(e) => exportAs(e.target.value)} aria-label="Export as another format">
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
              onSelect={selectVersion}
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
          clarify ? (
            <Clarify
              key={clarify.prompt}
              request={clarify}
              busy={!!busy}
              onAnswer={(answers) => generateNew({ prompt: clarify.prompt, format: clarify.format, answers }, 'Generating and reviewing…')}
              onSkip={() => generateNew({ prompt: clarify.prompt, format: clarify.format, clarify: false }, 'Generating and reviewing…')}
              onEdit={() => {
                setPrompt(clarify.prompt)
                setClarify(null)
                setTimeout(() => promptInput.current?.focus()) // after the form re-renders
              }}
            />
          ) : (
          <div className="empty">
            <p>Describe a system and get an architecture diagram.</p>
            <p className="muted">e.g. “Web app with React frontend, Django API, Postgres, Redis cache and a Celery worker”</p>
          </div>
          )
        )}

        {error && <p className="error">{error}</p>}
        {busy && <p className="muted">{busy}</p>}

        {!(clarify && !current) && <form onSubmit={submit}>
          {!current && (
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="svg">Auto-layout</option>
              <option value="mermaid">Mermaid</option>
            </select>
          )}
          <input
            ref={promptInput}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={current ? 'Describe a change…' : 'Describe your system…'}
            disabled={!!busy}
          />
          <button disabled={!!busy || !prompt.trim()}>{current ? 'Update' : 'Generate'}</button>
        </form>}
      </main>
    </div>
  )
}
