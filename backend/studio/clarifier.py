"""Clarifier: asks the user a few questions when a new-diagram request is too vague to model.

Runs before the generator, for new diagrams only (edits already have the current diagram as
context). It is advisory like the critic: any failure means "proceed without questions".
Detailed requests (HARNESS_CLARIFY_MAX_WORDS or more words) skip the LLM call entirely.
"""
import json

from django.conf import settings

MAX_QUESTIONS = 3
MAX_OPTIONS = 4

CLARIFY_PROMPT = (
    'You help draw software architecture diagrams. Decide whether a request has enough '
    'information to draw a useful system architecture diagram. Ask only when an answer would '
    'materially change the diagram: the kind of system is unclear, or a choice that reshapes it is '
    'open (e.g. monolith vs microservices, cloud provider, real-time vs batch, who the users are). '
    'Do not ask about details you can sensibly assume, and never ask when the request already '
    'names the system type and its main components. Ask at most 3 short questions, each with 2-4 '
    'concrete suggested answers (most likely first). Respond ONLY with JSON: '
    '{"ready": bool, "questions": [{"question": str, "options": [str]}]}. '
    'Use "ready": true and an empty list when no questions are needed.'
)


def needs_check(prompt: str) -> bool:
    """Cheap gate: only short requests are sent to the clarifier."""
    return settings.HARNESS_CLARIFY and len(prompt.split()) < settings.HARNESS_CLARIFY_MAX_WORDS


def parse_questions(data) -> list:
    """Normalize the clarifier's JSON into [{question, options}]; [] means ready."""
    if not isinstance(data, dict) or data.get('ready') is True:
        return []
    out = []
    for q in data.get('questions') or []:
        if not isinstance(q, dict) or not str(q.get('question') or '').strip():
            continue
        options = [str(o).strip()[:80] for o in (q.get('options') or []) if str(o).strip()]
        out.append({'question': str(q['question']).strip()[:200], 'options': options[:MAX_OPTIONS]})
    return out[:MAX_QUESTIONS]


def questions_for(client, prompt: str, extract_json=json.loads) -> list:
    """Questions to ask before generating, or [] to go ahead. Never raises."""
    if not needs_check(prompt):
        return []
    try:
        raw = client.complete([{'role': 'system', 'content': CLARIFY_PROMPT},
                               {'role': 'user', 'content': prompt}])
        return parse_questions(extract_json(raw))
    except Exception:  # advisory: API errors or junk mean no questions
        return []


def with_answers(prompt: str, answers) -> str:
    """The request with the user's answers appended (stored as the version's prompt)."""
    lines = []
    for a in (answers or [])[:MAX_QUESTIONS]:
        if not isinstance(a, dict):
            continue
        q, ans = str(a.get('question') or '').strip()[:200], str(a.get('answer') or '').strip()[:300]
        if q and ans:
            lines.append(f'- {q} {ans}')
    return f'{prompt}\n\nClarifications:\n' + '\n'.join(lines) if lines else prompt
