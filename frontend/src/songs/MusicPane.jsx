import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import { KEYS, arrange, render, schedule, toWav } from './engine'
import { loadVoices, speakLine, voicesFor } from './voices'

const slug = (t) => (t || 'song').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'song'

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function MusicPane({ song, caps, onChange, ensureSaved, setError }) {
  const [take, setTake] = useState(null) // { url, blob } of the AI-sung song
  const [composing, setComposing] = useState(false)
  const [status, setStatus] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [activeLine, setActiveLine] = useState(-1)
  const [browserVoices, setBrowserVoices] = useState([])
  const [voiceName, setVoiceName] = useState('')
  const [rate, setRate] = useState(1)
  const player = useRef(null) // { ctx, timers, raf }
  const clips = useRef(new Map()) // TTS mp3 cache: "lang|vocal|text" -> Blob

  const arr = useMemo(() => arrange(song), [song])
  const serverVoice = caps.tts
  const candidates = useMemo(() => voicesFor(browserVoices, song.language), [browserVoices, song.language])
  const browserVoice = candidates.find((v) => v.name === voiceName) || candidates[0]

  useEffect(() => { loadVoices().then(setBrowserVoices) }, [])
  useEffect(() => () => stop(), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => take && URL.revokeObjectURL(take.url), [take])

  const composeSong = async () => {
    setError(null)
    setComposing(true)
    try {
      const id = await ensureSaved()
      const blob = await api.compose(id)
      setTake({ blob, url: URL.createObjectURL(blob) })
    } catch (e) { setError(e.message) } finally { setComposing(false) }
  }

  // Fetches (and caches) neural TTS for every line, decoded into AudioBuffers.
  async function voiceLines(ctx) {
    const out = {}
    for (const [i, line] of arr.lines.entries()) {
      setStatus(`Voicing line ${i + 1} of ${arr.lines.length}…`)
      const k = `${song.language}|${song.vocal}|${line.text}`
      if (!clips.current.has(k)) clips.current.set(k, await api.speak(line.text, song.language, song.vocal))
      out[i] = await ctx.decodeAudioData(await clips.current.get(k).arrayBuffer())
    }
    setStatus(null)
    return out
  }

  function stop() {
    const p = player.current
    if (!p) return
    p.timers.forEach(clearTimeout)
    cancelAnimationFrame(p.raf)
    p.ctx.close()
    if ('speechSynthesis' in window) speechSynthesis.cancel()
    player.current = null
    setPlaying(false)
    setActiveLine(-1)
  }

  const play = async () => {
    stop()
    setError(null)
    if (!arr.lines.length) { setError('Write some lyrics first'); return }
    const ctx = new AudioContext()
    const p = { ctx, timers: [], raf: 0 }
    player.current = p
    setPlaying(true)
    try {
      const vocals = serverVoice ? await voiceLines(ctx) : {}
      if (player.current !== p) return // stopped while voicing
      const start = ctx.currentTime + 0.3
      schedule(ctx, arr, { start, genre: song.genre, vocals })
      if (!serverVoice && browserVoice) {
        arr.lines.forEach((line) => p.timers.push(setTimeout(
          () => speakLine(line.text, { language: song.language, voice: browserVoice, rate }),
          (start - ctx.currentTime + line.time) * 1000 + 50)))
      }
      const tick = () => {
        const t = ctx.currentTime - start
        if (t > arr.duration) { stop(); return }
        setActiveLine(arr.lines.findLastIndex((l) => l.time <= t))
        p.raf = requestAnimationFrame(tick)
      }
      tick()
    } catch (e) {
      setStatus(null)
      setError(e.message)
      stop()
    }
  }

  const exportWav = async () => {
    setError(null)
    try {
      const tmp = new AudioContext()
      const vocals = serverVoice ? await voiceLines(tmp) : {}
      tmp.close()
      setStatus('Rendering…')
      download(toWav(await render(arr, { genre: song.genre, vocals })), `${slug(song.title)}.wav`)
    } catch (e) { setError(e.message) } finally { setStatus(null) }
  }

  const mins = `${Math.floor(arr.duration / 60)}:${String(Math.round(arr.duration % 60)).padStart(2, '0')}`

  return (
    <section className="pane">
      <div className="pane-head">
        <h3>2 · Music</h3>
        <span className="muted">{arr.lines.length} sung lines · {mins}</span>
      </div>

      <div className="fields">
        <label>Tempo <b>{song.tempo} bpm</b>
          <input type="range" min="60" max="180" value={song.tempo} onChange={(e) => onChange({ tempo: Number(e.target.value) })} />
        </label>
        <label>Key
          <select value={song.key} onChange={(e) => onChange({ key: e.target.value })}>
            {KEYS.map((k) => <option key={k} value={k}>{k.endsWith('m') ? `${k.slice(0, -1)} minor` : `${k} major`}</option>)}
          </select>
        </label>
        <label>Singer
          <select value={song.vocal} onChange={(e) => onChange({ vocal: e.target.value })}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h4>AI singer — real human-sounding vocals</h4>
        <p className="muted">
          Produces a full song with a singer performing your lyrics in {caps.languages[song.language] || song.language},
          with native pronunciation and accent (ElevenLabs Music). Takes a minute or two.
        </p>
        {caps.music ? (
          <button className="primary" onClick={composeSong} disabled={composing || !arr.lines.length}>
            {composing ? 'Composing… (this can take a couple of minutes)' : take ? 'Compose a new take' : 'Compose song'}
          </button>
        ) : (
          <p className="hint">Set <code>ELEVENLABS_API_KEY</code> in <code>backend/.env</code> to enable sung vocals.</p>
        )}
        {take && (
          <div className="take">
            <audio controls src={take.url} />
            <button onClick={() => download(take.blob, `${slug(song.title)}.mp3`)}>Download MP3</button>
          </div>
        )}
      </div>

      <div className="card">
        <h4>Studio preview — beat + native voice</h4>
        <p className="muted">
          Instant, in-browser: a {song.genre} backing track in {song.key} with each line voiced on the downbeat
          by {serverVoice ? `a neural ${serverVoice} voice` : 'your browser’s speech voice'} speaking the language
          natively. Good for checking phrasing and flow before composing.
        </p>
        {!serverVoice && (
          <div className="fields">
            <label>Voice
              <select value={browserVoice?.name || ''} onChange={(e) => setVoiceName(e.target.value)}>
                {candidates.length
                  ? candidates.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)
                  : <option value="">No {caps.languages[song.language]} voice installed — instrumental only</option>}
              </select>
            </label>
            <label>Speed <b>{rate.toFixed(2)}×</b>
              <input type="range" min="0.7" max="1.4" step="0.05" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
            </label>
          </div>
        )}
        <div className="actions">
          {playing
            ? <button className="primary" onClick={stop}>■ Stop</button>
            : <button className="primary" onClick={play} disabled={!arr.lines.length}>▶ Play preview</button>}
          <button onClick={exportWav} disabled={playing || !arr.lines.length}>
            Download WAV{serverVoice ? '' : ' (instrumental)'}
          </button>
          {status && <span className="muted">{status}</span>}
        </div>
        <ol className="karaoke">
          {arr.lines.map((l, i) => (
            <li key={i} className={i === activeLine ? 'on' : ''} lang={song.language}>
              {(i === 0 || arr.lines[i - 1].section !== l.section) && <small>{l.section}</small>}
              {l.text}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
