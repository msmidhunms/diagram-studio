import { useState } from 'react'
import App from './App.jsx'
import SongStudio from './songs/SongStudio.jsx'

const TABS = { diagrams: 'Diagram Studio', songs: 'Song Studio' }

export default function Shell() {
  const [tab, setTab] = useState(() => (location.hash === '#songs' ? 'songs' : 'diagrams'))
  const go = (t) => { setTab(t); history.replaceState(null, '', t === 'songs' ? '#songs' : '#') }
  return (
    <div className="shell">
      <nav className="tabs">
        {Object.entries(TABS).map(([k, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => go(k)}>{label}</button>
        ))}
      </nav>
      {tab === 'songs' ? <SongStudio /> : <App />}
    </div>
  )
}
