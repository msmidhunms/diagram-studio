import { useRef, useState } from 'react'
import { GENRES } from './engine'
import { parseLyrics, syllables } from './lyrics'

const PLACEHOLDER = `[Verse 1]
Write your first line here
Keep each line short and singable

[Chorus]
This is the part everyone sings
Repeat it so it sticks`

export default function LyricsPane({ song, languages, onChange, onWrite, busy }) {
  const [brief, setBrief] = useState('')
  const meter = useRef(null)
  const sections = parseLyrics(song.lyrics)
  const lineCount = sections.reduce((n, s) => n + s.lines.length, 0)
  const seconds = Math.round(((lineCount * 8 + 16) * 60) / song.tempo)
  const hasLyrics = !!song.lyrics.trim()

  const write = (e) => {
    e.preventDefault()
    if (!brief.trim() || busy) return
    onWrite(brief, hasLyrics)
  }

  return (
    <section className="pane">
      <div className="pane-head">
        <h3>1 · Lyrics</h3>
        <span className="muted">{sections.length} sections · {lineCount} lines · ~{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
      </div>

      <div className="fields">
        <input className="title" value={song.title} placeholder="Song title" onChange={(e) => onChange({ title: e.target.value })} />
        <label>Language
          <select value={song.language} onChange={(e) => onChange({ language: e.target.value })}>
            {Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label>Genre
          <select value={song.genre} onChange={(e) => onChange({ genre: e.target.value })}>
            {GENRES.map((g) => <option key={g}>{g}</option>)}
          </select>
        </label>
        <label>Mood
          <input value={song.mood} onChange={(e) => onChange({ mood: e.target.value })} placeholder="uplifting" />
        </label>
      </div>

      <form className="brief" onSubmit={write}>
        <input value={brief} onChange={(e) => setBrief(e.target.value)} disabled={!!busy}
          placeholder={hasLyrics ? 'Ask AI to revise, e.g. “make the chorus more hopeful”' : 'What is the song about? e.g. “monsoon rain in my village”'} />
        <button disabled={!!busy || !brief.trim()}>{hasLyrics ? 'Revise with AI' : 'Write with AI'}</button>
      </form>

      <div className="editor">
        <ol className="meter" ref={meter} aria-label="Syllables per line">
          {song.lyrics.split('\n').map((raw, i) => {
            const line = raw.trim()
            const header = /^\[.*\]$/.test(line)
            return <li key={i}>{line && !header ? syllables(line) : ''}</li>
          })}
        </ol>
        <textarea value={song.lyrics} placeholder={PLACEHOLDER} spellCheck={false} lang={song.language} wrap="off"
          onScroll={(e) => { meter.current.scrollTop = e.target.scrollTop }}
          onChange={(e) => onChange({ lyrics: e.target.value })} />
      </div>
      <p className="muted">Use [Verse], [Chorus], [Bridge]… on their own line. The number beside each line is its approximate syllable count — keep lines in a section close to each other so they fit the beat.</p>
    </section>
  )
}
