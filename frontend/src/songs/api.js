async function request(path, options) {
  const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options })
  const audio = (res.headers.get('Content-Type') || '').startsWith('audio/')
  if (res.ok && audio) return res.blob()
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

export const capabilities = () => request('/songs/capabilities/')
export const listSongs = () => request('/songs/').then((d) => d.songs)
export const getSong = (id) => request(`/songs/${id}/`)
export const createSong = (fields) => post('/songs/', fields)
export const updateSong = (id, fields) => request(`/songs/${id}/`, { method: 'PATCH', body: JSON.stringify(fields) })
export const deleteSong = (id) => request(`/songs/${id}/`, { method: 'DELETE' })
export const writeLyrics = (body) => post('/songs/lyrics/', body)
export const compose = (id) => post(`/songs/${id}/compose/`)
export const speak = (text, language, vocal) => post('/songs/speak/', { text, language, vocal })
