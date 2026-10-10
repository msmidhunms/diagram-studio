// Mirrors backend/songs/lyrics.py: bracketed headers split the song into sections.
const HEADER = /^\s*\[([^\]]{1,100})\]\s*$/

export function parseLyrics(text) {
  const sections = []
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(HEADER)
    if (m) { sections.push({ name: m[1].trim(), lines: [] }); continue }
    if (!sections.length) sections.push({ name: 'Verse', lines: [] })
    sections.at(-1).lines.push(line)
  }
  return sections.filter((s) => s.lines.length)
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

// Rough syllable estimate: vowel groups for Latin script, grapheme clusters
// (≈ aksharas / kana / hangul blocks) for other scripts.
export function syllables(line) {
  const latin = line.match(/[a-zA-ZÀ-ɏ]+/g) || []
  let n = latin.reduce((sum, w) => sum + Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouyà-ÿ]+/g) || []).length), 0)
  const other = line.replace(/[a-zA-ZÀ-ɏ\s\d\p{P}]/gu, '')
  if (other) {
    n += segmenter ? [...segmenter.segment(other)].length : other.length
  }
  return n
}
