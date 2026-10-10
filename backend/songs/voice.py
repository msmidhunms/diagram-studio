"""Audio providers.

- `compose()` turns lyrics into a fully produced song with sung, human-sounding vocals in the
  lyrics' language (ElevenLabs Music, composition-plan mode).
- `speak()` reads one lyric line with a neural text-to-speech voice that pronounces the
  language like a native speaker (ElevenLabs or OpenAI). The browser studio places these
  lines on the beat; without a provider it falls back to the browser's own voices.
"""
import json
import urllib.error
import urllib.request

from django.conf import settings

from .languages import name as language_name
from .lyrics import Section

ELEVENLABS_URL = 'https://api.elevenlabs.io'
BEATS_PER_LINE = 8          # two bars of 4/4 per sung line
INTRO_BEATS = 8
MIN_SECTION_MS, MAX_SECTION_MS, MAX_SONG_MS = 3000, 120000, 600000


class VoiceError(RuntimeError):
    pass


def capabilities():
    return {'music': bool(settings.ELEVENLABS_API_KEY), 'tts': tts_provider()}


def tts_provider():
    p = settings.TTS_PROVIDER.lower()
    if p == 'elevenlabs' and settings.ELEVENLABS_API_KEY:
        return 'elevenlabs'
    if p == 'openai' and _openai_key():
        return 'openai'
    return None


def _openai_key():
    if settings.OPENAI_API_KEY:
        return settings.OPENAI_API_KEY
    return settings.LLM_API_KEY if settings.LLM_PROVIDER.lower() == 'openai' else ''


def _elevenlabs(path, body, params='output_format=mp3_44100_128', timeout=60) -> bytes:
    req = urllib.request.Request(
        f'{ELEVENLABS_URL}{path}?{params}', data=json.dumps(body).encode(), method='POST',
        headers={'xi-api-key': settings.ELEVENLABS_API_KEY, 'Content-Type': 'application/json',
                 'Accept': 'audio/mpeg'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors='replace')[:400]
        raise VoiceError(f'ElevenLabs returned {e.code}: {detail}')
    except urllib.error.URLError as e:
        raise VoiceError(f'Could not reach ElevenLabs: {e.reason}')


def _beats_ms(beats, tempo):
    return round(beats * 60000 / tempo)


def composition_plan(sections: list[Section], *, language, genre, mood, vocal, tempo, key) -> dict:
    lang = language_name(language)
    plan_sections = [{
        'section_name': 'Intro', 'positive_local_styles': ['instrumental intro'],
        'negative_local_styles': ['vocals'], 'lines': [],
        'duration_ms': max(MIN_SECTION_MS, _beats_ms(INTRO_BEATS, tempo)),
    }]
    for s in sections:
        is_chorus = 'chorus' in s.name.lower() or 'hook' in s.name.lower()
        plan_sections.append({
            'section_name': s.name[:100],
            'positive_local_styles': ['full band, big catchy hook, layered harmonies'] if is_chorus else [],
            'negative_local_styles': [],
            'lines': s.lines,
            'duration_ms': min(MAX_SECTION_MS, max(MIN_SECTION_MS, _beats_ms(len(s.lines) * BEATS_PER_LINE, tempo))),
        })
    total = sum(s['duration_ms'] for s in plan_sections)
    if total > MAX_SONG_MS:
        raise VoiceError(f'Song would be {total // 1000}s long; the limit is {MAX_SONG_MS // 1000}s. Shorten the lyrics.')
    return {
        'positive_global_styles': [
            genre, mood, f'{tempo} bpm', f'key of {key}',
            f'{vocal} lead vocalist singing in {lang}',
            f'native {lang} pronunciation and accent, clear natural diction',
            'expressive human vocal performance',
        ],
        'negative_global_styles': ['robotic voice', 'autotune artifacts', 'foreign accent',
                                   'mispronounced lyrics', 'gibberish lyrics'],
        'sections': plan_sections,
    }


def compose(sections, **style) -> bytes:
    if not settings.ELEVENLABS_API_KEY:
        raise VoiceError('ELEVENLABS_API_KEY is not set, so AI vocals are unavailable')
    plan = composition_plan(sections, **style)
    # music_v1 is the model that accepts a sections-based composition plan
    return _elevenlabs('/v1/music', {'composition_plan': plan, 'model_id': 'music_v1'}, timeout=600)


def speak(text: str, language: str, vocal: str) -> bytes:
    provider = tts_provider()
    if provider == 'elevenlabs':
        voice = settings.ELEVENLABS_MALE_VOICE if vocal == 'male' else settings.ELEVENLABS_FEMALE_VOICE
        body = {'text': text, 'model_id': settings.ELEVENLABS_TTS_MODEL,
                'voice_settings': {'stability': 0.4, 'similarity_boost': 0.8, 'style': 0.5}}
        if settings.ELEVENLABS_TTS_MODEL != 'eleven_multilingual_v2':  # v2 detects language itself
            body['language_code'] = language.split('-')[0]
        return _elevenlabs(f'/v1/text-to-speech/{voice}', body)
    if provider == 'openai':
        from openai import OpenAI
        lang = language_name(language)
        resp = OpenAI(api_key=_openai_key()).audio.speech.create(
            model=settings.OPENAI_TTS_MODEL, voice='ash' if vocal == 'male' else 'coral', input=text,
            response_format='mp3',
            instructions=(f'You are a native {lang} speaker performing song lyrics. Pronounce every word '
                          f'with an authentic native {lang} accent and natural intonation. Rhythmic, '
                          'warm, expressive delivery, as if half-singing to a beat.'))
        return resp.content
    raise VoiceError('No text-to-speech provider configured (set TTS_PROVIDER)')
