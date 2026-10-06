import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from . import harness
from .sanitize import InvalidDiagram, check_mermaid, sanitize_svg


def fake_client(*replies):
    replies = list(replies)
    def create(**kw):
        content = replies.pop(0)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


def reply(code, title='T'):
    return json.dumps({'title': title, 'explanation': 'e', 'code': code})


class SanitizeTests(TestCase):
    def test_svg_strips_scripts_and_handlers(self):
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
               '<script>alert(1)</script><rect onclick="x()" width="1" height="1"/>'
               '<a href="javascript:alert(1)"><text>hi</text></a></svg>')
        out = sanitize_svg(svg)
        self.assertNotIn('script', out)
        self.assertNotIn('onclick', out)
        self.assertNotIn('javascript', out)

    def test_svg_rejects_doctype_and_malformed(self):
        with self.assertRaises(InvalidDiagram):
            sanitize_svg('<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>')
        with self.assertRaises(InvalidDiagram):
            sanitize_svg('<svg viewBox="0 0 1 1"><g></svg>')

    def test_mermaid_check(self):
        self.assertTrue(check_mermaid('```mermaid\nflowchart TD\nA-->B\n```').startswith('flowchart'))
        with self.assertRaises(InvalidDiagram):
            check_mermaid('Here is your diagram: A-->B')


class HarnessTests(TestCase):
    def test_repairs_invalid_then_succeeds(self):
        client = fake_client('not json', reply('flowchart TD\nA-->B'))
        r = harness.generate('x', 'mermaid', client=client)
        self.assertEqual(r.repairs, 1)

    def test_gives_up_after_max_repairs(self):
        client = fake_client('bad', 'bad', 'bad')
        with self.assertRaises(harness.HarnessError):
            harness.generate('x', 'mermaid', client=client)


class ApiTests(TestCase):
    def post(self, url, body):
        return self.client.post(url, json.dumps(body), content_type='application/json')

    def test_generate_iterate_repair(self):
        with patch('studio.harness.get_client', return_value=fake_client(
                reply('flowchart TD\nA-->B'), reply('flowchart TD\nA-->B-->C'), reply('flowchart TD\nA-->B-->C-->D'))):
            d = self.post('/api/diagrams/generate/', {'prompt': 'web app'}).json()
            self.assertEqual(len(d['versions']), 1)
            d = self.post('/api/diagrams/generate/', {'prompt': 'add C', 'diagram_id': d['id']}).json()
            self.assertEqual(len(d['versions']), 2)
            d = self.post(f"/api/diagrams/{d['id']}/repair/", {'error': 'Parse error line 2'}).json()
            self.assertEqual(len(d['versions']), 3)
        self.assertEqual(self.client.get('/api/diagrams/').json()['diagrams'][0]['id'], d['id'])

    def test_validation_errors(self):
        self.assertEqual(self.post('/api/diagrams/generate/', {'prompt': ''}).status_code, 400)
        self.assertEqual(self.post('/api/diagrams/generate/', {'prompt': 'x', 'format': 'png'}).status_code, 400)

    def test_missing_api_key_is_502(self):
        with self.settings(DEEPSEEK_API_KEY=''):
            self.assertEqual(self.post('/api/diagrams/generate/', {'prompt': 'x'}).status_code, 502)
