"""Lyrics: parsing into sections, and an LLM writer with a validate-and-repair loop.

Lyrics are plain text with bracketed section headers:

    [Verse 1]
    line
    line
    [Chorus]
    ...
"""
import re
from dataclasses import dataclass, field

from django.conf import settings

from studio.harness import _extract_json
from studio.llm import LLMConfigError, get_llm

from .languages import name as language_name

HEADER = re.compile(r'^\s*\[([^\]]{1,100})\]\s*$')
MAX_LINES_PER_SECTION = 30
MAX_LINE_CHARS = 200


class LyricsError(RuntimeError):
    pass


@dataclass
class Section:
    name: str
    lines: list = field(default_factory=list)


def parse(text: str) -> list[Section]:
    sections = []
    for raw in (text or '').splitlines():
        line = raw.strip()
        if not line:
            continue
        m = HEADER.match(line)
        if m:
            sections.append(Section(m.group(1).strip()))
            continue
        if not sections:
            sections.append(Section('Verse'))
        sections[-1].lines.append(line)
    return [s for s in sections if s.lines]


def check(text: str) -> list[Section]:
    sections = parse(text)
    if not sections:
        raise LyricsError('Lyrics are empty')
    for s in sections:
        if len(s.lines) > MAX_LINES_PER_SECTION:
            raise LyricsError(f'[{s.name}] has {len(s.lines)} lines (max {MAX_LINES_PER_SECTION})')
        for line in s.lines:
            if len(line) > MAX_LINE_CHARS:
                raise LyricsError(f'A line in [{s.name}] is longer than {MAX_LINE_CHARS} characters')
    return sections


SYSTEM_PROMPT = (
    'You are a professional songwriter who writes natively in many languages. '
    'Respond ONLY with a JSON object: {"title": str, "lyrics": str}. '
    'Write the lyrics entirely in {language}, in its native script, the way a native speaker '
    'would actually sing it: idiomatic, natural word order, no literal translation, no '
    'transliteration unless the language is usually written in Latin script. '
    'Structure the song with section headers on their own line in English square brackets, '
    'e.g. [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Outro]. '
    'Keep lines short and singable with a steady syllable count per section, use rhyme or '
    'assonance that works in {language}, and repeat the chorus. '
    'At most 12 lines per section and 160 characters per line. '
    'The title is in {language} too.'
)


def _client():
    try:
        return get_llm()
    except LLMConfigError as e:
        raise LyricsError(str(e))


def write(brief: str, language: str, genre: str, mood: str, current: str = '', client=None) -> dict:
    """Write new lyrics from a brief, or revise `current` following the brief."""
    client = client or _client()
    lang = language_name(language)
    messages = [{'role': 'system', 'content': SYSTEM_PROMPT.replace('{language}', lang)}]
    style = f'Genre: {genre}. Mood: {mood}. Language: {lang}.'
    if current.strip():
        messages.append({'role': 'user', 'content':
                         f'{style}\nCurrent lyrics:\n{current}\n\nRevise them as follows and return the full song: {brief}'})
    else:
        messages.append({'role': 'user', 'content': f'{style}\nWrite a song about: {brief}'})

    last_error = None
    for _ in range(settings.HARNESS_MAX_REPAIRS + 1):
        raw = client.complete(messages, temperature=0.9)
        try:
            data = _extract_json(raw)
            lyrics = data['lyrics']
            if not isinstance(lyrics, str):
                raise TypeError
            check(lyrics)
            return {'title': str(data.get('title', ''))[:200], 'lyrics': lyrics.strip()}
        except (ValueError, KeyError, TypeError, LyricsError) as e:
            last_error = e if isinstance(e, LyricsError) else 'Response must be a JSON object with a "lyrics" string'
            messages = messages + [
                {'role': 'assistant', 'content': raw},
                {'role': 'user', 'content': f'That output was invalid: {last_error}. Return a corrected JSON object.'},
            ]
    raise LyricsError(f'Could not write valid lyrics: {last_error}')
