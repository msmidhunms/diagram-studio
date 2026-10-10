import { useCallback, useEffect, useState } from 'react'
import * as api from './api'
import LyricsPane from './LyricsPane'
import MusicPane from './MusicPane'

const BLANK = { id: null, title: '', language: 'en-US', genre: 'pop', mood: 'uplifting', vocal: 'female', tempo: 96, key: 'C', lyrics: '' }
const FIELDS = ['title', 'language', 'genre', 'mood', 'vocal', 'tempo', 'key', 'lyrics']
const pick = (song) => Object.fromEntries(FIELDS.map((f) => [f, song[f]]))

export default function SongStudio() {
  const [songs, setSongs] = useState([])
  const [song, setSong] = useState(BLANK)
  const [dirty, setDirty] = useState(false)
  const [caps, setCaps] = useState({ music: false, tts: null, languages: { 'en-US': 'English (US)' } })
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = useCallback(() => api.listSongs().then(setSongs).catch((e) => setError(e.message)), [])
  useEffect(() => {
    refresh()
    api.capabilities().then(setCaps).catch((e) => setError(e.message))
  }, [refresh])

  const change = (fields) => { setSong((s) => ({ ...s, ...fields })); setDirty(true) }

  const save = async () => {
    const saved = song.id ? await api.updateSong(song.id, pick(song)) : await api.createSong(pick(song))
    setSong((cur) => ({ ...cur, id: saved.id }))
    setDirty(false)
    refresh()
    return saved.id
  }

  const ensureSaved = async () => (dirty || !song.id ? save() : song.id)

  const guard = async (label, fn) => {
    setBusy(label)
    setError(null)
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  const open = (id) => guard('Loading…', async () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    setSong(await api.getSong(id))
    setDirty(false)
    setConfirmDelete(false)
  })

  const newSong = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    setSong(BLANK)
    setDirty(false)
    setError(null)
  }

  const remove = () => guard('Deleting…', async () => {
    await api.deleteSong(song.id)
    setSong(BLANK)
    setDirty(false)
    setConfirmDelete(false)
    refresh()
  })

  const writeLyrics = (brief, revise) => guard(revise ? 'Revising lyrics…' : 'Writing lyrics…', async () => {
    const out = await api.writeLyrics({ brief, language: song.language, genre: song.genre, mood: song.mood, lyrics: revise ? song.lyrics : '' })
    change({ lyrics: out.lyrics, ...(song.title ? {} : { title: out.title }) })
  })

  return (
    <div className="app">
      <aside>
        <h1>Song Studio</h1>
        <button onClick={newSong}>+ New song</button>
        <ul>
          {songs.map((s) => (
            <li key={s.id}>
              <button className={song.id === s.id ? 'active' : ''} onClick={() => open(s.id)}>
                {s.title || `Song ${s.id}`} <small>{caps.languages[s.language] || s.language}</small>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main>
        <header>
          <h2>{song.title || 'Untitled song'}{dirty && <span className="muted"> · unsaved</span>}</h2>
          <div className="actions">
            {busy && <span className="muted">{busy}</span>}
            <button onClick={() => guard('Saving…', save)} disabled={!!busy || (!dirty && !!song.id)}>Save</button>
            {song.id && (confirmDelete ? (
              <>
                <button className="danger" onClick={remove}>Confirm delete</button>
                <button onClick={() => setConfirmDelete(false)}>Cancel</button>
              </>
            ) : <button onClick={() => setConfirmDelete(true)}>Delete</button>)}
          </div>
        </header>
        {error && <p className="error">{error}</p>}
        <div className="panes">
          <LyricsPane song={song} languages={caps.languages} onChange={change} onWrite={writeLyrics} busy={busy} />
          <MusicPane song={song} caps={caps} onChange={change} ensureSaved={ensureSaved} setError={setError} />
        </div>
      </main>
    </div>
  )
}
