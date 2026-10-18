import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import critic, harness
from .models import Diagram
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


@override_settings(HARNESS_CRITIC_ROUNDS=-1)
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
                                         'group': None, 'tech': None, 'icon': None})
        self.assertEqual(m['edges'][0]['style'], 'sync')

    def test_icons_are_checked_against_the_catalogue(self):
        m = validate_model({'nodes': [{'id': 'f', 'icon': 'AWS:Lambda'}, {'id': 'g', 'icon': 'aws:teleporter'},
                                      {'id': 'h', 'icon': 'azure:cosmos db'}, {'id': 'i', 'icon': 42}]})
        self.assertEqual([n['icon'] for n in m['nodes']], ['aws:lambda', None, 'azure:cosmos_db', None])

    def test_icon_change_shows_in_diff(self):
        old = validate_model({'nodes': [{'id': 'f', 'label': 'Fn'}]})
        new = validate_model({'nodes': [{'id': 'f', 'label': 'Fn', 'icon': 'gcp:cloud_run'}]})
        self.assertEqual(diff_models(old, new)['changed_nodes'], ['Fn'])

    def test_prompt_lists_every_icon(self):
        from .sysmodel import ICONS
        for key in ICONS:
            provider, service = key.split(':')
            self.assertIn(service, harness.SYSTEM_PROMPT)

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


@override_settings(HARNESS_CRITIC_ROUNDS=-1, HARNESS_CLARIFY=False)
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


def creply(score, *issues, summary='s'):
    return json.dumps({'score': score, 'approved': True, 'summary': summary,
                       'issues': [{'severity': s, 'target': t, 'problem': p, 'fix': 'f'} for s, t, p in issues]})


@override_settings(HARNESS_CRITIC_ROUNDS=1, LLM_CRITIC_MODEL='', HARNESS_CLARIFY=False)
class CriticTests(TestCase):
    def test_lint_finds_structural_issues(self):
        m = validate_model({'groups': [{'id': 'empty', 'label': 'Empty'}],
                            'nodes': [{'id': 'a'}, {'id': 'b'}, {'id': 'lonely'}],
                            'edges': [{'from': 'a', 'to': 'b'}, {'from': 'a', 'to': 'b'}, {'from': 'a', 'to': 'a'}]})
        problems = [i['problem'] for i in critic.lint(m)]
        self.assertEqual(len(problems), 4)
        self.assertTrue(any('no connections' in p for p in problems))
        self.assertTrue(any('Duplicate' in p for p in problems))
        self.assertTrue(any('Self-loop' in p for p in problems))
        self.assertTrue(any('empty' in p for p in problems))
        self.assertEqual(critic.lint(validate_model(model('a', 'b', edges=[('a', 'b')]))), [])

    def test_approval_follows_major_issues_not_the_flag(self):
        rev = critic.parse_review({'score': 99, 'approved': True,
                                   'issues': [{'problem': 'x'}, {'severity': 'major', 'problem': 'no DB'}, 'junk']})
        self.assertFalse(rev.approved)
        self.assertEqual(rev.score, 10)
        self.assertEqual([i['severity'] for i in rev.issues], ['major', 'minor'])

    def test_approved_draft_is_not_revised(self):
        client = fake_client(mreply('a', 'b', edges=[('a', 'b')]), creply(9))
        r = harness.generate('x', client=client)
        self.assertEqual(len(client.calls), 2)
        self.assertEqual(r.review['score'], 9)
        self.assertTrue(r.review['approved'])
        self.assertEqual(r.review['revisions'], 0)
        # the critic sees the request and the model, not the generator's conversation
        self.assertEqual(client.calls[1][0]['content'], critic.CRITIC_PROMPT)
        self.assertIn('User request:\nx', client.calls[1][1]['content'])

    def test_major_issue_triggers_revision(self):
        client = fake_client(mreply('a', 'b', edges=[('a', 'b')]),
                             creply(4, ('major', 'a', 'missing database')),
                             mreply('a', 'b', 'db', edges=[('a', 'b'), ('b', 'db')]), creply(8))
        r = harness.generate('x', client=client)
        self.assertEqual([n['id'] for n in r.model['nodes']], ['a', 'b', 'db'])
        self.assertEqual(r.review, {'score': 8, 'approved': True, 'summary': 's', 'issues': [], 'revisions': 1})
        feedback = client.calls[2][-1]['content']
        self.assertIn('[major] a: missing database -> f', feedback)
        self.assertEqual(client.calls[2][-2]['role'], 'assistant')  # generator continues its own conversation

    def test_worse_revision_does_not_replace_better_draft(self):
        client = fake_client(mreply('a', 'b', edges=[('a', 'b')]), creply(6, ('major', '', 'p')),
                             mreply('z'), creply(3, ('major', '', 'q')))
        r = harness.generate('x', client=client)
        self.assertEqual([n['id'] for n in r.model['nodes']], ['a', 'b'])
        self.assertEqual(r.review['score'], 6)
        self.assertEqual(r.review['revisions'], 1)

    def test_rounds_are_bounded(self):
        with self.settings(HARNESS_CRITIC_ROUNDS=0):
            client = fake_client(mreply('a'), creply(2, ('major', '', 'bad')))
            r = harness.generate('x', client=client)
        self.assertEqual(len(client.calls), 2)
        self.assertFalse(r.review['approved'])

    def test_critic_failure_keeps_draft(self):
        client = fake_client(mreply('a', 'b', edges=[('a', 'b')]), 'not json at all')
        r = harness.generate('x', client=client)
        self.assertEqual(len(r.model['nodes']), 2)
        self.assertIsNone(r.review)

    def test_invalid_revision_keeps_reviewed_draft(self):
        client = fake_client(mreply('a'), creply(5, ('major', '', 'p')), 'bad', 'bad', 'bad')
        r = harness.generate('x', client=client)
        self.assertEqual(r.review['score'], 5)

    def test_edit_review_includes_previous_model(self):
        client = fake_client(mreply('a', 'b', edges=[('a', 'b')]), creply(9))
        harness.generate('add b', 'flowchart LR', model('a'), client=client)
        self.assertIn('Model before this edit', client.calls[1][1]['content'])
        self.assertIn('User request:\nadd b', client.calls[1][1]['content'])

    def test_lint_issues_reach_the_critic_and_review(self):
        client = fake_client(mreply('a', 'b'), creply(7))
        r = harness.generate('x', client=client)
        self.assertIn('Automated checks already found', client.calls[1][1]['content'])
        self.assertEqual(len(r.review['issues']), 2)  # both nodes unconnected

    def test_review_is_stored_and_returned(self):
        with patch('studio.harness.get_client', return_value=fake_client(
                mreply('a', 'b', edges=[('a', 'b')]), creply(9, ('minor', 'a', 'rename')))):
            d = self.client.post('/api/diagrams/generate/', json.dumps({'prompt': 'x'}),
                                 content_type='application/json').json()
        self.assertEqual(d['versions'][0]['review']['score'], 9)
        self.assertEqual(d['versions'][0]['review']['issues'][0]['problem'], 'rename')

    def test_separate_critic_model(self):
        with self.settings(LLM_PROVIDER='anthropic', LLM_API_KEY='k', LLM_MODEL='gen', LLM_CRITIC_MODEL='crit'):
            self.assertEqual(harness.get_critic_client().model, 'crit')
            self.assertEqual(harness.get_client().model, 'gen')


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


class IconProxyTests(TestCase):
    SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><script>x()</script><rect width="8" height="8"/></svg>'

    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.override = self.settings(ICON_CACHE_DIR=__import__('pathlib').Path(self.tmp.name))
        self.override.enable()

    def tearDown(self):
        self.override.disable()
        self.tmp.cleanup()

    def test_serves_sanitized_catalogue_icon_and_caches_it(self):
        with patch('studio.icons._download', return_value=self.SVG) as dl:
            r = self.client.get('/api/icons/aws:lambda.svg')
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r['Content-Type'], 'image/svg+xml')
            self.assertNotIn(b'script', r.content)
            self.client.get('/api/icons/aws:lambda.svg')
        dl.assert_called_once()  # second request served from the disk cache
        self.assertIn('icons.terrastruct.com', dl.call_args[0][0])

    def test_only_catalogue_keys_are_fetched(self):
        with patch('studio.icons._download') as dl:
            self.assertEqual(self.client.get('/api/icons/aws:nope.svg').status_code, 404)
            self.assertEqual(self.client.get('/api/icons/https:evil.example.svg').status_code, 404)
            self.assertEqual(self.client.get('/api/icons/gcp:bigquery.svg').status_code, 502)  # no artwork
        dl.assert_not_called()

    def test_network_or_content_failures_are_502(self):
        from studio.icons import IconUnavailable
        for err in (OSError('offline'), IconUnavailable('not an SVG')):
            with patch('studio.icons._download', side_effect=err):
                self.assertEqual(self.client.get('/api/icons/azure:functions.svg').status_code, 502)
        with patch('studio.icons._download', return_value=b'<html>nope</html>'):
            self.assertEqual(self.client.get('/api/icons/azure:functions.svg').status_code, 502)


class MermaidParityTests(TestCase):
    def test_python_renderer_matches_shared_golden_file(self):
        """The frontend's JS port (exporters/mermaid.js) is checked against the same file."""
        from pathlib import Path
        fixtures = Path(__file__).resolve().parents[2] / 'shared' / 'fixtures'
        model = validate_model(json.loads((fixtures / 'ecommerce.json').read_text()))
        self.assertEqual(to_mermaid(model) + '\n', (fixtures / 'ecommerce.mmd').read_text())


@override_settings(HARNESS_CRITIC_ROUNDS=-1, HARNESS_CLARIFY=True, HARNESS_CLARIFY_MAX_WORDS=25)
class ClarifierTests(TestCase):
    QUESTIONS = json.dumps({'ready': False, 'questions': [
        {'question': 'Which cloud?', 'options': ['AWS', 'Azure', 'GCP', 'On-prem', 'Other']},
        {'question': '  ', 'options': ['ignored']},
        {'question': 'Real-time chat or async messages?', 'options': ['Real-time', 'Async']},
    ]})

    def post(self, body):
        return self.client.post('/api/diagrams/generate/', json.dumps(body), content_type='application/json')

    def test_parse_questions(self):
        from .clarifier import parse_questions
        qs = parse_questions(json.loads(self.QUESTIONS))
        self.assertEqual([q['question'] for q in qs], ['Which cloud?', 'Real-time chat or async messages?'])
        self.assertEqual(len(qs[0]['options']), 4)  # capped
        self.assertEqual(parse_questions({'ready': True, 'questions': [{'question': 'x?'}]}), [])
        self.assertEqual(parse_questions('nonsense'), [])

    def test_vague_request_returns_questions_and_creates_nothing(self):
        client = fake_client(self.QUESTIONS)
        with patch('studio.harness.get_client', return_value=client):
            r = self.post({'prompt': 'a chat app'}).json()
        self.assertTrue(r['needs_clarification'])
        self.assertEqual(r['prompt'], 'a chat app')
        self.assertEqual(len(r['questions']), 2)
        self.assertEqual(Diagram.objects.count(), 0)

    def test_answers_are_added_to_the_prompt_and_stored(self):
        client = fake_client(mreply('a', 'b'))
        answers = [{'question': 'Which cloud?', 'answer': 'AWS'}, {'question': 'Unanswered?', 'answer': ' '}]
        with patch('studio.harness.get_client', return_value=client):
            d = self.post({'prompt': 'a chat app', 'answers': answers}).json()
        self.assertEqual(d['versions'][0]['prompt'], 'a chat app\n\nClarifications:\n- Which cloud? AWS')
        self.assertIn('- Which cloud? AWS', client.calls[0][-1]['content'])  # generator saw the answers
        self.assertEqual(len(client.calls), 1)  # answered: no second clarifier call

    def test_skip_detailed_and_edit_requests_never_ask(self):
        long_prompt = ' '.join(['word'] * 25)
        for body in ({'prompt': 'a chat app', 'clarify': False}, {'prompt': long_prompt}):
            client = fake_client(mreply('a'))
            with patch('studio.harness.get_client', return_value=client):
                d = self.post(body).json()
            self.assertIn('versions', d)
            self.assertEqual(len(client.calls), 1, body)  # generator only
        with patch('studio.harness.get_client', return_value=fake_client(mreply('a', 'b'))) as gc:
            r = self.post({'prompt': 'add b', 'diagram_id': d['id']}).json()
        self.assertEqual(len(r['versions']), 2)
        self.assertEqual(len(gc.return_value.calls), 1)

    def test_clarifier_failure_or_ready_means_generate(self):
        for first in ('not json at all', json.dumps({'ready': True, 'questions': []})):
            client = fake_client(first, mreply('a'))
            with patch('studio.harness.get_client', return_value=client):
                d = self.post({'prompt': 'a chat app'}).json()
            self.assertIn('versions', d, first)

    def test_disabled_by_setting(self):
        client = fake_client(mreply('a'))
        with self.settings(HARNESS_CLARIFY=False), patch('studio.harness.get_client', return_value=client):
            self.assertIn('versions', self.post({'prompt': 'a chat app'}).json())
        self.assertEqual(len(client.calls), 1)

    def test_bad_answers_are_400(self):
        self.assertEqual(self.post({'prompt': 'x', 'answers': 'AWS'}).status_code, 400)
