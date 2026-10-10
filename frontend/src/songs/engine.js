// In-browser arranger: turns lyrics into a timed arrangement (chords, drums, bass) and
// schedules it on a Web Audio context. Each lyric line gets a 2-bar phrase, matching the
// backend's composition plan, so vocal lines land on the downbeat.
import { parseLyrics } from './lyrics'

const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
export const KEYS = NOTES.flatMap((k) => [k, `${k}m`])
export const GENRES = ['pop', 'rock', 'ballad', 'hip-hop', 'r&b', 'edm', 'folk', 'lo-fi', 'bollywood', 'reggaeton']

const BEATS_PER_BAR = 4
const BARS_PER_LINE = 2
const INTRO_BARS = 2

// scale degrees (semitones from the tonic) and chord quality
const MAJOR = { I: [0, 'M'], ii: [2, 'm'], iii: [4, 'm'], IV: [5, 'M'], V: [7, 'M'], vi: [9, 'm'] }
const MINOR = { i: [0, 'm'], iv: [5, 'm'], v: [7, 'm'], V: [7, 'M'], III: [3, 'M'], VI: [8, 'M'], VII: [10, 'M'] }
const PROGRESSIONS = {
  major: { verse: ['I', 'V', 'vi', 'IV'], chorus: ['IV', 'I', 'V', 'vi'], bridge: ['vi', 'IV', 'ii', 'V'] },
  minor: { verse: ['i', 'VI', 'III', 'VII'], chorus: ['i', 'iv', 'VI', 'V'], bridge: ['VI', 'VII', 'iv', 'V'] },
}

function sectionKind(name) {
  const n = name.toLowerCase()
  if (n.includes('chorus') || n.includes('hook')) return 'chorus'
  if (n.includes('bridge')) return 'bridge'
  return 'verse'
}

function chordNotes(tonicMidi, degree, minorKey) {
  const [offset, quality] = (minorKey ? MINOR : MAJOR)[degree]
  const root = tonicMidi + offset
  return [root, root + (quality === 'm' ? 3 : 4), root + 7]
}

export function arrange({ lyrics, tempo, key }) {
  const minor = key.endsWith('m')
  const tonic = 48 + Math.max(0, NOTES.indexOf(minor ? key.slice(0, -1) : key)) // from C3
  const prog = PROGRESSIONS[minor ? 'minor' : 'major']
  const bars = []
  const lines = []
  for (let i = 0; i < INTRO_BARS; i++) {
    bars.push({ chord: chordNotes(tonic, prog.verse[i % 4], minor), kind: 'intro', section: 'Intro' })
  }
  for (const section of parseLyrics(lyrics)) {
    const kind = sectionKind(section.name)
    section.lines.forEach((text) => {
      lines.push({ text, section: section.name, bar: bars.length })
      for (let b = 0; b < BARS_PER_LINE; b++) {
        bars.push({ chord: chordNotes(tonic, prog[kind][bars.length % 4], minor), kind, section: section.name })
      }
    })
  }
  // two-bar tail so the last line rings out
  bars.push({ chord: chordNotes(tonic, prog.verse[0], minor), kind: 'outro', section: 'Outro' })
  bars.push({ chord: chordNotes(tonic, prog.verse[0], minor), kind: 'outro', section: 'Outro' })
  const secPerBeat = 60 / tempo
  const barSec = secPerBeat * BEATS_PER_BAR
  return {
    bars, barSec, secPerBeat,
    phraseSec: barSec * BARS_PER_LINE,
    duration: bars.length * barSec,
    lines: lines.map((l) => ({ ...l, time: l.bar * barSec })),
  }
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)

const noiseCache = new WeakMap()
function noise(ctx) {
  if (!noiseCache.has(ctx)) {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseCache.set(ctx, buf)
  }
  return noiseCache.get(ctx)
}

function env(ctx, dest, t, peak, attack, release) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release)
  g.connect(dest)
  return g
}

function kick(ctx, dest, t) {
  const o = ctx.createOscillator()
  o.frequency.setValueAtTime(140, t)
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
  o.connect(env(ctx, dest, t, 0.9, 0.003, 0.3))
  o.start(t); o.stop(t + 0.35)
}

function noiseHit(ctx, dest, t, { type, freq, peak, release }) {
  const s = ctx.createBufferSource()
  s.buffer = noise(ctx)
  const f = ctx.createBiquadFilter()
  f.type = type; f.frequency.value = freq
  s.connect(f); f.connect(env(ctx, dest, t, peak, 0.002, release))
  s.start(t, Math.random() * 0.5); s.stop(t + release + 0.05)
}

const snare = (ctx, dest, t) => noiseHit(ctx, dest, t, { type: 'bandpass', freq: 1800, peak: 0.45, release: 0.18 })
const clap = (ctx, dest, t) => noiseHit(ctx, dest, t, { type: 'bandpass', freq: 1200, peak: 0.4, release: 0.12 })
const hat = (ctx, dest, t, open) => noiseHit(ctx, dest, t, { type: 'highpass', freq: 7000, peak: 0.12, release: open ? 0.2 : 0.04 })

function tone(ctx, dest, t, midi, dur, { type = 'triangle', peak = 0.1, attack = 0.02, cutoff = 2400 } = {}) {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.value = hz(midi)
  const f = ctx.createBiquadFilter()
  f.type = 'lowpass'; f.frequency.value = cutoff
  o.connect(f); f.connect(env(ctx, dest, t, peak, attack, dur))
  o.start(t); o.stop(t + attack + dur + 0.05)
}

// One bar of drums per genre: steps are 16th-note indexes.
const DRUMS = {
  pop:       { kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  rock:      { kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  ballad:    { kick: [0], snare: [8], hat: [0, 4, 8, 12] },
  'hip-hop': { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 11, 12, 14] },
  'r&b':     { kick: [0, 3, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  edm:       { kick: [0, 4, 8, 12], clap: [4, 12], hat: [2, 6, 10, 14], open: true },
  folk:      { kick: [0, 8], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  'lo-fi':   { kick: [0, 7, 9], snare: [4, 12], hat: [0, 4, 8, 12] },
  bollywood: { kick: [0, 3, 6, 10], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  reggaeton: { kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
}

function scheduleBar(ctx, dest, bar, t, arr, genre) {
  const step = arr.secPerBeat / 4
  const soft = bar.kind === 'intro' || bar.kind === 'outro' || genre === 'ballad'
  const d = DRUMS[genre] || DRUMS.pop
  if (bar.kind !== 'intro') {
    d.kick.forEach((s) => kick(ctx, dest, t + s * step))
    d.snare?.forEach((s) => snare(ctx, dest, t + s * step))
    d.clap?.forEach((s) => clap(ctx, dest, t + s * step))
    if (bar.kind !== 'outro') d.hat.forEach((s) => hat(ctx, dest, t + s * step, d.open))
  }
  // pad: sustained chord
  bar.chord.forEach((n) => tone(ctx, dest, t, n + 12, arr.barSec * 0.95, { type: 'sawtooth', peak: 0.035, attack: 0.15, cutoff: bar.kind === 'chorus' ? 2200 : 1200 }))
  // bass: root on beats 1 and 3 (every beat in the chorus)
  const beats = bar.kind === 'chorus' ? [0, 1, 2, 3] : [0, 2]
  beats.forEach((b) => tone(ctx, dest, t + b * arr.secPerBeat, bar.chord[0] - 12, arr.secPerBeat * 0.9, { type: 'sine', peak: 0.3, attack: 0.01 }))
  // arpeggio for gentler genres and verses
  if (soft || ['folk', 'lo-fi', 'pop', 'bollywood'].includes(genre)) {
    const pattern = [0, 1, 2, 1, 0, 1, 2, 1]
    pattern.forEach((p, i) => tone(ctx, dest, t + i * step * 2, bar.chord[p] + 24, step * 2.5, { type: 'triangle', peak: 0.05, attack: 0.005, cutoff: 3500 }))
  }
}

// Schedules the whole backing track (and any decoded vocal buffers) starting at `start`.
// `vocals` maps line index -> AudioBuffer.
export function schedule(ctx, arr, { start, genre, vocals = {}, dest = ctx.destination }) {
  const music = ctx.createGain()
  music.gain.value = Object.keys(vocals).length ? 0.55 : 0.8
  music.connect(dest)
  arr.bars.forEach((bar, i) => scheduleBar(ctx, music, bar, start + i * arr.barSec, arr, genre))
  const voice = ctx.createGain()
  voice.gain.value = 1.4
  voice.connect(dest)
  arr.lines.forEach((line, i) => {
    const buf = vocals[i]
    if (!buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    // keep a long line inside its phrase without audibly changing the voice
    src.playbackRate.value = Math.min(1.1, Math.max(1, buf.duration / (arr.phraseSec * 0.95)))
    src.connect(voice)
    src.start(start + line.time + 0.05)
  })
  return music
}

// Renders the arrangement (with vocal buffers) to an AudioBuffer offline.
export async function render(arr, { genre, vocals }) {
  const rate = 44100
  const ctx = new OfflineAudioContext(2, Math.ceil((arr.duration + 1) * rate), rate)
  schedule(ctx, arr, { start: 0, genre, vocals })
  return ctx.startRendering()
}

export function toWav(buffer) {
  const ch = buffer.numberOfChannels
  const len = buffer.length * ch * 2
  const view = new DataView(new ArrayBuffer(44 + len))
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); view.setUint32(4, 36 + len, true); str(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true)
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * ch * 2, true)
  view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, len, true)
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c))
  let o = 44
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]))
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}
