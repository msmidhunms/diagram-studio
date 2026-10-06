async function request(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const listDiagrams = () => request('/diagrams/').then((d) => d.diagrams)
export const getDiagram = (id) => request(`/diagrams/${id}/`)
export const generate = (body) =>
  request('/diagrams/generate/', { method: 'POST', body: JSON.stringify(body) })
export const repair = (id, error) =>
  request(`/diagrams/${id}/repair/`, { method: 'POST', body: JSON.stringify({ error }) })
