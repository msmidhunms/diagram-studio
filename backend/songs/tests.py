import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from . import lyrics, voice

LYRICS = '[Verse 1]\nline one\nline two\n\n[Chorus]\nhook line\nhook line'


def fake_client(*replies):
    replies = list(replies)
    return SimpleNamespace(complete=lambda messages, **kw: replies.pop(0))


class FakeResponse:
    def __init__(self, data):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.data


class LyricsTests(TestCase):
    def test_parse_sections(self):
        s = lyrics.parse('untitled first line\n[Chorus]\n  a  \n\n[Empty]\n[Bridge]\nb')
        self.assertEqual([(x.name, x.lines) for x in s],
                         [('Verse', ['untitled first line']), ('Chorus', ['a']), ('Bridge', ['b'])])

    def test_check_limits(self):
        with self.assertRaises(lyrics.LyricsError):
            lyrics.check('  ')
        with self.assertRaises(lyrics.LyricsError):
            lyrics.check('[Verse]\n' + 'x' * 201)

    def test_write_repairs_then_succeeds(self):
        client = fake_client('nope', json.dumps({'title': 'Mazha', 'lyrics': '[Verse 1]\nമഴ പെയ്യുന്നു'}))
        out = lyrics.write('rain', 'ml-IN', 'ballad', 'calm', client=client)
        self.assertEqual(out['title'], 'Mazha')

    def test_prompt_names_language(self):
        seen = []

        def complete(messages, **kw):
            seen.extend(messages)
            return json.dumps({'title': 't', 'lyrics': '[Verse]\na'})
        lyrics.write('love', 'hi-IN', 'pop', 'happy', client=SimpleNamespace(complete=complete))
        self.assertIn('Hindi', seen[0]['content'])


class VoiceTests(TestCase):
    def test_plan_durations_and_styles(self):
        plan = voice.composition_plan(lyrics.parse(LYRICS), language='ta-IN', genre='folk', mood='joyful',
                                      vocal='male', tempo=120, key='D')
        self.assertEqual([s['section_name'] for s in plan['sections']], ['Intro', 'Verse 1', 'Chorus'])
        self.assertEqual(plan['sections'][1]['duration_ms'], 8000)  # 2 lines x 8 beats at 120 bpm
        self.assertTrue(any('native Tamil pronunciation' in s for s in plan['positive_global_styles']))

    def test_plan_rejects_too_long_song(self):
        text = ''.join(f'[V{i}]\n' + 'la\n' * 30 for i in range(10))
        with self.assertRaises(voice.VoiceError):
            voice.composition_plan(lyrics.parse(text), language='en-US', genre='pop', mood='',
                                   vocal='female', tempo=60, key='C')

    def test_tts_provider_resolution(self):
        with self.settings(TTS_PROVIDER='elevenlabs', ELEVENLABS_API_KEY=''):
            self.assertIsNone(voice.tts_provider())
        with self.settings(TTS_PROVIDER='openai', OPENAI_API_KEY='', LLM_PROVIDER='openai', LLM_API_KEY='k'):
            self.assertEqual(voice.tts_provider(), 'openai')


class ApiTests(TestCase):
    def post(self, url, body):
        return self.client.post(url, json.dumps(body), content_type='application/json')

    def test_crud(self):
        s = self.post('/api/songs/', {'title': 'Rain', 'language': 'ml-IN', 'lyrics': LYRICS}).json()
        url = f"/api/songs/{s['id']}/"
        r = self.client.patch(url, json.dumps({'tempo': 130, 'mood': 'sad'}), content_type='application/json')
        self.assertEqual((r.json()['tempo'], r.json()['mood']), (130, 'sad'))
        bad = self.client.patch(url, json.dumps({'tempo': 999}), content_type='application/json')
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.post('/api/songs/', {'language': 'xx'}).status_code, 400)
        self.assertEqual(self.client.get('/api/songs/').json()['songs'][0]['title'], 'Rain')
        self.assertEqual(self.client.delete(url).status_code, 200)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_write_lyrics(self):
        reply = json.dumps({'title': 'T', 'lyrics': LYRICS})
        with patch('songs.lyrics.get_llm', return_value=fake_client(reply)):
            r = self.post('/api/songs/lyrics/', {'brief': 'summer', 'language': 'es-ES'})
        self.assertEqual(r.json()['lyrics'], LYRICS)
        self.assertEqual(self.post('/api/songs/lyrics/', {'brief': ''}).status_code, 400)

    def test_compose_sends_plan_and_returns_mp3(self):
        s = self.post('/api/songs/', {'language': 'hi-IN', 'lyrics': LYRICS}).json()
        sent = {}

        def urlopen(req, timeout):
            sent.update(url=req.full_url, key=req.headers['Xi-api-key'], body=json.loads(req.data))
            return FakeResponse(b'ID3audio')
        with self.settings(ELEVENLABS_API_KEY='k'), patch('urllib.request.urlopen', urlopen):
            r = self.client.post(f"/api/songs/{s['id']}/compose/")
        self.assertEqual((r.status_code, r['Content-Type'], r.content), (200, 'audio/mpeg', b'ID3audio'))
        self.assertTrue(sent['url'].startswith('https://api.elevenlabs.io/v1/music?'))
        self.assertEqual(sent['body']['model_id'], 'music_v1')
        self.assertEqual(sent['body']['composition_plan']['sections'][2]['lines'], ['hook line', 'hook line'])

    def test_compose_without_key_is_502(self):
        s = self.post('/api/songs/', {'lyrics': LYRICS}).json()
        with self.settings(ELEVENLABS_API_KEY=''):
            self.assertEqual(self.client.post(f"/api/songs/{s['id']}/compose/").status_code, 502)

    def test_speak_elevenlabs_passes_language(self):
        sent = {}

        def urlopen(req, timeout):
            sent.update(url=req.full_url, body=json.loads(req.data))
            return FakeResponse(b'mp3')
        with self.settings(ELEVENLABS_API_KEY='k', TTS_PROVIDER='elevenlabs', ELEVENLABS_TTS_MODEL='eleven_v3'), \
                patch('urllib.request.urlopen', urlopen):
            r = self.post('/api/songs/speak/', {'text': 'നമസ്കാരം', 'language': 'ml-IN', 'vocal': 'male'})
        self.assertEqual(r.content, b'mp3')
        self.assertEqual(sent['body']['language_code'], 'ml')
        self.assertIn('JBFqnCBsd6RMkjVDRZzb', sent['url'])

    def test_capabilities(self):
        with self.settings(ELEVENLABS_API_KEY='', TTS_PROVIDER=''):
            caps = self.client.get('/api/songs/capabilities/').json()
        self.assertEqual((caps['music'], caps['tts']), (False, None))
        self.assertEqual(caps['languages']['ml-IN'], 'Malayalam')
