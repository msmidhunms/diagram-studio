import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from . import harness
from .render_mermaid import to_mermaid
from .sanitize import InvalidDiagram, check_mermaid, sanitize_svg
from .sysmodel import diff_models, validate_model


def fake_client(*replies):
    replies = list(replies)
    calls = []

    def complete(messages):
        calls.append(messages)
        return replies.pop(0)
    return SimpleNamespace(complete=complete, calls=calls)


def model(*ids, edges=(), groups=()):
    return {'direction': 'LR', 'groups': [{'id': g, 'label': g.upper(), 'kind': 'trust_zone'} for g in groups],
            'nodes': [{'id': i, 'label': i.title(), 'type': 'service'} for i in ids],
            'edges': [{'from': a, 'to': b} for a, b in edges]}


def mreply(*ids, edges=(), title='T'):
    return json.dumps({'title': title, 'explanation': 'e', 'model': model(*ids, edges=edges)})


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
    def test_json_wrapped_in_prose_is_accepted(self):
        client = fake_client('Sure! ' + mreply('a', 'b', edges=[('a', 'b')]) + ' Hope it helps.')
        self.assertEqual(harness.generate('x', client=client).repairs, 0)

    def test_repairs_invalid_then_succeeds(self):
        client = fake_client('not json', mreply('a'))
        r = harness.generate('x', client=client)
        self.assertEqual(r.repairs, 1)

    def test_invalid_model_error_is_fed_back(self):
        client = fake_client(json.dumps({'model': {'nodes': [{'id': 'a'}], 'edges': [{'from': 'a', 'to': 'x'}]}}),
                             mreply('a'))
        harness.generate('x', client=client)
        self.assertIn('unknown node "x"', client.calls[1][-1]['content'])

    def test_iteration_sends_previous_model(self):
        client = fake_client(mreply('a', 'b'))
        harness.generate('add b', 'flowchart LR', model('a'), client=client)
        self.assertIn('Current system model', client.calls[0][-1]['content'])

    def test_legacy_mermaid_without_model_is_converted(self):
        client = fake_client(mreply('a', 'b'))
        r = harness.generate('add b', 'flowchart LR\nA-->B', None, client=client)
        self.assertIn('Current diagram:\nflowchart LR', client.calls[0][-1]['content'])
        self.assertEqual(len(r.model['nodes']), 2)

    def test_legacy_svg_is_converted(self):
        client = fake_client(mreply('a'))
        r = harness.generate('add a', '<svg xmlns="http://www.w3.org/2000/svg"/>', None, client=client)
        self.assertIn('Current diagram:\n<svg', client.calls[0][-1]['content'])
        self.assertTrue(r.code.startswith('flowchart'))

    def test_gives_up_after_max_repairs(self):
        client = fake_client('bad', 'bad', 'bad')
        with self.assertRaises(harness.HarnessError):
            harness.generate('x', client=client)


class SystemModelTests(TestCase):
    def test_normalizes_ids_and_unknown_values(self):
        m = validate_model({'direction': 'sideways', 'nodes': [
            {'id': 'api gw', 'label': '  API   Gateway ', 'type': 'spaceship'}],
            'edges': [{'from': 'api gw', 'to': 'api gw', 'style': 'teleport'}]})
        self.assertEqual(m['direction'], 'LR')
        self.assertEqual(m['nodes'][0], {'id': 'api_gw', 'label': 'API Gateway', 'type': 'other',
                                         'group': None, 'tech': None})
        self.assertEqual(m['edges'][0]['style'], 'sync')

    def test_rejects_broken_references(self):
        bad = [
            {'nodes': []},
            {'nodes': [{'id': 'a'}, {'id': 'a'}]},
            {'nodes': [{'id': 'a'}], 'edges': [{'from': 'a', 'to': 'ghost'}]},
            {'nodes': [{'id': 'a', 'group': 'nope'}]},
            {'groups': [{'id': 'x', 'parent': 'y'}, {'id': 'y', 'parent': 'x'}], 'nodes': [{'id': 'a'}]},
            {'nodes': 'a, b'},
        ]
        for m in bad:
            with self.subTest(m=m), self.assertRaises(InvalidDiagram):
                validate_model(m)

    def test_mermaid_render(self):
        m = validate_model({'direction': 'TD', 'groups': [
            {'id': 'vpc', 'label': 'VPC', 'kind': 'trust_zone'},
            {'id': 'data', 'label': 'Data "tier"', 'kind': 'tier', 'parent': 'vpc'}],
            'nodes': [{'id': 'end', 'label': 'Web (React)', 'type': 'client'},
                      {'id': 'db', 'label': 'Orders', 'type': 'database', 'group': 'data', 'tech': 'Postgres'}],
            'edges': [{'from': 'end', 'to': 'db', 'label': 'SQL', 'style': 'async'}]})
        code = to_mermaid(m)
        self.assertTrue(code.startswith('flowchart TD'))
        self.assertIn('n_end(["Web (React)"])', code)  # keyword-safe id, stadium shape
        self.assertIn('n_db[("Orders<br/>Postgres")]', code)
        self.assertIn('subgraph g_data["Data #quot;tier#quot;"]', code)
        self.assertIn('n_end -.->|"SQL"| n_db', code)
        self.assertIn('style g_vpc', code)
        self.assertEqual(code.count('subgraph'), code.count('\n  end') + code.count('\n    end'))

    def test_diff(self):
        old = validate_model(model('a', 'b', edges=[('a', 'b')]))
        new = validate_model(model('a', 'c', edges=[('a', 'c')]))
        new['nodes'][0]['label'] = 'Renamed'
        d = diff_models(old, new)
        self.assertEqual(d, {'added_nodes': ['C'], 'removed_nodes': ['B'], 'changed_nodes': ['Renamed'],
                             'added_edges': ['a->c'], 'removed_edges': ['a->b']})
        self.assertIsNone(diff_models(None, new))


class ApiTests(TestCase):
    def post(self, url, body):
        return self.client.post(url, json.dumps(body), content_type='application/json')

    def test_generate_iterate_repair(self):
        with patch('studio.harness.get_client', return_value=fake_client(
                mreply('a', 'b', edges=[('a', 'b')]), mreply('a', 'b', 'c', edges=[('a', 'b'), ('b', 'c')]),
                mreply('a', 'b', 'c'))):
            d = self.post('/api/diagrams/generate/', {'prompt': 'web app'}).json()
            self.assertEqual(len(d['versions']), 1)
            d = self.post('/api/diagrams/generate/', {'prompt': 'add C', 'diagram_id': d['id']}).json()
            self.assertEqual(len(d['versions']), 2)
            self.assertEqual(d['versions'][1]['changes']['added_nodes'], ['C'])
            self.assertEqual(d['versions'][1]['changes']['added_edges'], ['b->c'])
            self.assertIn('n_c', d['versions'][1]['code'])
            d = self.post(f"/api/diagrams/{d['id']}/repair/", {'error': 'Parse error line 2'}).json()
            self.assertEqual(len(d['versions']), 3)
        self.assertEqual(self.client.get('/api/diagrams/').json()['diagrams'][0]['id'], d['id'])

    def test_rename_and_delete(self):
        with patch('studio.harness.get_client', return_value=fake_client(mreply('a'))):
            d = self.post('/api/diagrams/generate/', {'prompt': 'x'}).json()
        url = f"/api/diagrams/{d['id']}/"
        r = self.client.patch(url, json.dumps({'title': 'Renamed'}), content_type='application/json')
        self.assertEqual(r.json()['title'], 'Renamed')
        bad = self.client.patch(url, json.dumps({'title': ' '}), content_type='application/json')
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.client.delete(url).status_code, 200)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_svg_format_stores_model(self):
        with patch('studio.harness.get_client', return_value=fake_client(mreply('a', 'b'))):
            d = self.post('/api/diagrams/generate/', {'prompt': 'x', 'format': 'svg'}).json()
        self.assertEqual(d['format'], 'svg')
        self.assertEqual(len(d['versions'][0]['model']['nodes']), 2)

    def test_validation_errors(self):
        self.assertEqual(self.post('/api/diagrams/generate/', {'prompt': ''}).status_code, 400)
        self.assertEqual(self.post('/api/diagrams/generate/', {'prompt': 'x', 'format': 'png'}).status_code, 400)

    def test_missing_api_key_is_502(self):
        with self.settings(LLM_PROVIDER='openai', LLM_API_KEY=''):
            self.assertEqual(self.post('/api/diagrams/generate/', {'prompt': 'x'}).status_code, 502)


class LLMConfigTests(TestCase):
    def test_provider_resolution(self):
        from .llm import AnthropicChat, LLMConfigError, OpenAIChat, get_llm
        with self.settings(LLM_PROVIDER='ollama', LLM_API_KEY='', LLM_MODEL='', LLM_BASE_URL=''):
            llm = get_llm()
            self.assertIsInstance(llm, OpenAIChat)
            self.assertEqual(llm.model, 'llama3.1')
        with self.settings(LLM_PROVIDER='anthropic', LLM_API_KEY='k', LLM_MODEL='', LLM_BASE_URL=''):
            self.assertIsInstance(get_llm(), AnthropicChat)
        with self.settings(LLM_PROVIDER='nope'), self.assertRaises(LLMConfigError):
            get_llm()
        with self.settings(LLM_PROVIDER='openai_compatible', LLM_BASE_URL='http://x/v1', LLM_MODEL=''), \
                self.assertRaises(LLMConfigError):
            get_llm()
