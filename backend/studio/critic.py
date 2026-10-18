"""Critic agent: reviews a generated system model against the user's request.

The generator (harness.py) drafts a model; the critic reviews it and returns structured
issues. Major issues go back to the generator for a revision, for a bounded number of rounds.

Two layers:
  - lint(): deterministic structural checks (no LLM). Cheap facts such as orphan nodes or
    duplicate edges, passed to the LLM critic so it doesn't have to find them itself.
  - review(): the LLM critic. It sees the request (and the previous model when editing) but
    not the generator's reasoning, so it judges the diagram on its own merits.

The critic is advisory: if it fails or returns junk, the draft is accepted as is.
"""
import json
from dataclasses import dataclass, field

from .sysmodel import NODE_TYPES

SEVERITIES = ('major', 'minor')
MAX_ISSUES = 12
READABLE_NODES = 25

CRITIC_PROMPT = (
    'You are a strict reviewer of software architecture diagrams. You get a user request and a '
    'structured system model (JSON) that another agent produced for it. Judge the model on:\n'
    '1. Completeness: every component, actor and flow the request names or clearly implies is present.\n'
    '2. Correctness: edges point from caller to callee (or producer to consumer); edge style fits '
    '("sync" request/response, "async" events/messages, "data" replication or bulk flow); node types '
    f'fit ({", ".join(NODE_TYPES)}); nothing contradicts the request.\n'
    '3. Structure: tiers, networks and trust zones are grouped sensibly; public vs private boundaries '
    'are explicit when security matters; nesting is meaningful.\n'
    '4. Readability: short labels, no redundant or invented components, at most ~25 nodes.\n'
    '5. For edits: the requested change is applied and unrelated parts are unchanged.\n'
    'Severity "major" means the diagram is wrong or missing something the user asked for; '
    '"minor" is polish. Do not ask for things the user did not request or imply. '
    'Respond ONLY with JSON: {"score": 1-10, "approved": bool, "summary": str (one sentence), '
    '"issues": [{"severity": "major"|"minor", "target": node/group/edge id or "" , '
    '"problem": str, "fix": str}]}. Approve when there are no major issues.'
)


@dataclass
class Review:
    score: int
    approved: bool
    summary: str = ''
    issues: list = field(default_factory=list)

    @property
    def major(self):
        return [i for i in self.issues if i['severity'] == 'major']

    def as_dict(self):
        return {'score': self.score, 'approved': self.approved, 'summary': self.summary,
                'issues': self.issues}


def lint(model: dict) -> list:
    """Structural issues found without the LLM, in the same shape as critic issues."""
    issues = []
    nodes, edges = model['nodes'], model['edges']
    connected = {e['from'] for e in edges} | {e['to'] for e in edges}
    if len(nodes) > 1:
        for n in nodes:
            if n['id'] not in connected:
                issues.append(_issue('minor', n['id'], f'"{n["label"]}" has no connections',
                                     'Connect it to the components it talks to, or remove it'))
    seen = set()
    for e in edges:
        if e['from'] == e['to']:
            issues.append(_issue('minor', e['from'], f'Self-loop on "{e["from"]}"',
                                 'Remove it unless the component really calls itself'))
        key = (e['from'], e['to'], e['style'])
        if key in seen:
            issues.append(_issue('minor', f"{e['from']}->{e['to']}", 'Duplicate edge',
                                 'Merge into one edge with a combined label'))
        seen.add(key)
    used = {n['group'] for n in nodes} | {g['parent'] for g in model['groups']}
    for g in model['groups']:
        if g['id'] not in used:
            issues.append(_issue('minor', g['id'], f'Group "{g["label"]}" is empty',
                                 'Put components in it or remove it'))
    if len(nodes) > READABLE_NODES:
        issues.append(_issue('minor', '', f'{len(nodes)} nodes is hard to read',
                             f'Merge minor components to stay under ~{READABLE_NODES}'))
    return issues


def _issue(severity, target, problem, fix):
    return {'severity': severity, 'target': target, 'problem': problem, 'fix': fix}


def _clean_issue(raw):
    if not isinstance(raw, dict) or not raw.get('problem'):
        return None
    severity = raw.get('severity') if raw.get('severity') in SEVERITIES else 'minor'
    return _issue(severity, str(raw.get('target') or '')[:60], str(raw['problem'])[:300],
                  str(raw.get('fix') or '')[:300])


def parse_review(data, lint_issues=()) -> Review:
    """Normalize the critic's JSON. Lint issues are merged in (deduplicated by target+problem)."""
    if not isinstance(data, dict):
        raise ValueError('critic response is not an object')
    issues = [i for i in map(_clean_issue, data.get('issues') or []) if i]
    known = {(i['target'], i['problem']) for i in issues}
    issues += [i for i in lint_issues if (i['target'], i['problem']) not in known]
    issues.sort(key=lambda i: SEVERITIES.index(i['severity']))
    issues = issues[:MAX_ISSUES]
    try:
        score = max(1, min(10, int(data.get('score', 5))))
    except (TypeError, ValueError):
        score = 5
    # approval follows the issues, not the critic's own flag, so the loop is consistent
    approved = not any(i['severity'] == 'major' for i in issues)
    return Review(score, approved, str(data.get('summary') or '')[:300], issues)


def review(client, request: str, model: dict, previous_model: dict | None = None,
           extract_json=json.loads) -> Review:
    lint_issues = lint(model)
    parts = [f'User request:\n{request}']
    if previous_model:
        parts.append(f'Model before this edit:\n{json.dumps(previous_model)}')
    parts.append(f'Model to review:\n{json.dumps(model)}')
    if lint_issues:
        parts.append('Automated checks already found:\n' + '\n'.join(
            f'- [{i["severity"]}] {i["target"]}: {i["problem"]}' for i in lint_issues))
    raw = client.complete([{'role': 'system', 'content': CRITIC_PROMPT},
                           {'role': 'user', 'content': '\n\n'.join(parts)}])
    return parse_review(extract_json(raw), lint_issues)


def feedback(rev: Review) -> str:
    """The critique as a message to the generator."""
    lines = [f'- [{i["severity"]}] {i["target"] or "diagram"}: {i["problem"]}'
             + (f' -> {i["fix"]}' if i['fix'] else '') for i in rev.issues]
    return ('A reviewer checked your diagram against the request'
            + (f' ({rev.summary})' if rev.summary else '') + ':\n' + '\n'.join(lines) + '\n'
            'Revise the model to fix every major issue and any minor ones that are clearly right. '
            'Ignore feedback that conflicts with the user\'s request, keep ids of unchanged '
            'components stable, and return the full JSON object.')

