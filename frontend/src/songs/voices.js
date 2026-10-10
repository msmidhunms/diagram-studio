// Browser speech voices. Neural/online voices ("Natural", "Online", "Google", "Neural")
// sound far more like a native human speaker than the legacy offline ones, so rank them first.
const NATURAL = /natural|neural|online|google|premium|enhanced/i

export function loadVoices() {
  if (!('speechSynthesis' in window)) return Promise.resolve([])
  const now = speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1500)
  })
}

export function voicesFor(voices, language) {
  const tag = language.toLowerCase()
  const base = tag.split('-')[0]
  const score = (v) => {
    const lang = v.lang.toLowerCase().replace('_', '-')
    if (!lang.startsWith(base)) return -1
    return (lang === tag ? 2 : 0) + (NATURAL.test(v.name) ? 4 : 0) + (v.localService ? 0 : 1)
  }
  return voices.filter((v) => score(v) >= 0).sort((a, b) => score(b) - score(a))
}

export function speakLine(text, { language, voice, rate = 1 }) {
  const u = new SpeechSynthesisUtterance(text)
  u.lang = language
  if (voice) u.voice = voice
  u.rate = rate
  speechSynthesis.speak(u)
  return u
}
