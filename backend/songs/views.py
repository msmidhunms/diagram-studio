from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from studio.views import _body

from . import lyrics, voice
from .languages import LANGUAGES
from .models import Song

MAX_BRIEF = 2000
MAX_LYRICS = 20000
FIELDS = {'title': 200, 'language': 20, 'genre': 60, 'mood': 60, 'vocal': 20, 'key': 10, 'lyrics': MAX_LYRICS}


def _song(s):
    return {'id': s.id, 'title': s.title, 'language': s.language, 'genre': s.genre, 'mood': s.mood,
            'vocal': s.vocal, 'tempo': s.tempo, 'key': s.key, 'lyrics': s.lyrics,
            'updated_at': s.updated_at.isoformat()}


def _apply(song, data):
    for f, limit in FIELDS.items():
        if f in data:
            value = str(data[f]).strip() if f != 'lyrics' else str(data[f])
            if len(value) > limit:
                raise ValueError(f'{f} is too long (max {limit} chars)')
            setattr(song, f, value)
    if song.language not in LANGUAGES:
        raise ValueError('Unsupported language')
    if 'tempo' in data:
        try:
            tempo = int(data['tempo'])
        except (TypeError, ValueError):
            raise ValueError('tempo must be a number')
        if not 50 <= tempo <= 200:
            raise ValueError('tempo must be between 50 and 200')
        song.tempo = tempo
    return song


def _err(fn):
    try:
        return fn()
    except ValueError as e:
        return JsonResponse({'error': str(e)}, status=400)
    except lyrics.LyricsError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except voice.VoiceError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:  # upstream API failures (network, auth, rate limit)
        return JsonResponse({'error': f'Request failed: {type(e).__name__}'}, status=502)


def _get(pk):
    try:
        return Song.objects.get(pk=pk)
    except Song.DoesNotExist:
        return None


@csrf_exempt  # local dev API, like the diagram API; add auth before exposing publicly
@require_http_methods(['GET'])
def capabilities(request):
    return JsonResponse({**voice.capabilities(), 'languages': LANGUAGES})


@csrf_exempt
@require_http_methods(['GET', 'POST'])
def song_list(request):
    if request.method == 'POST':
        def create():
            song = _apply(Song(), _body(request))
            song.save()
            return JsonResponse(_song(song), status=201)
        return _err(create)
    songs = Song.objects.all()[:100]
    return JsonResponse({'songs': [{'id': s.id, 'title': s.title, 'language': s.language} for s in songs]})


@csrf_exempt
@require_http_methods(['GET', 'PATCH', 'DELETE'])
def song_detail(request, pk):
    song = _get(pk)
    if not song:
        return JsonResponse({'error': 'Not found'}, status=404)
    if request.method == 'DELETE':
        song.delete()
        return JsonResponse({'deleted': pk})
    if request.method == 'PATCH':
        def update():
            _apply(song, _body(request)).save()
            return JsonResponse(_song(song))
        return _err(update)
    return JsonResponse(_song(song))


@csrf_exempt
@require_http_methods(['POST'])
def write_lyrics(request):
    """Body: {brief, language, genre, mood, lyrics?}. With lyrics, revises them per the brief."""
    def go():
        data = _body(request)
        brief = str(data.get('brief', '')).strip()
        if not brief or len(brief) > MAX_BRIEF:
            raise ValueError(f'brief is required (max {MAX_BRIEF} chars)')
        language = str(data.get('language', 'en-US'))
        if language not in LANGUAGES:
            raise ValueError('Unsupported language')
        current = str(data.get('lyrics', ''))[:MAX_LYRICS]
        return JsonResponse(lyrics.write(brief, language, str(data.get('genre', 'pop'))[:60],
                                         str(data.get('mood', ''))[:60], current))
    return _err(go)


@csrf_exempt
@require_http_methods(['POST'])
def compose(request, pk):
    """Render the saved song to an MP3 with AI-sung vocals."""
    song = _get(pk)
    if not song:
        return JsonResponse({'error': 'Not found'}, status=404)

    def go():
        try:
            sections = lyrics.check(song.lyrics)
        except lyrics.LyricsError as e:
            raise ValueError(str(e))
        audio = voice.compose(sections, language=song.language, genre=song.genre, mood=song.mood,
                              vocal=song.vocal, tempo=song.tempo, key=song.key)
        return HttpResponse(audio, content_type='audio/mpeg')
    return _err(go)


@csrf_exempt
@require_http_methods(['POST'])
def speak(request):
    """Body: {text, language, vocal}. One lyric line as MP3 speech."""
    def go():
        data = _body(request)
        text = str(data.get('text', '')).strip()
        if not text or len(text) > lyrics.MAX_LINE_CHARS:
            raise ValueError(f'text is required (max {lyrics.MAX_LINE_CHARS} chars)')
        language = str(data.get('language', 'en-US'))
        if language not in LANGUAGES:
            raise ValueError('Unsupported language')
        return HttpResponse(voice.speak(text, language, str(data.get('vocal', 'female'))), content_type='audio/mpeg')
    return _err(go)
