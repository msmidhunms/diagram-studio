"""LLM harness: prompt -> structured system model, with a validate-and-repair loop.

"Plan, then render": the model returns {title, explanation, model} where `model` is a
structured system model (see sysmodel.py). It is validated, then rendered without the LLM:
to Mermaid here (stored as `code`), and to an auto-laid-out SVG in the browser (ELK).
The diagram's format only picks the default view; both views come from the same model.

On invalid output the error is fed back to the model for a bounded number of repair
attempts. Browser-side render errors can be fed back the same way through `repair()`.
"""
import json
from dataclasses import dataclass

from django.conf import settings

from .llm import LLMConfigError, get_llm
from .render_mermaid import to_mermaid
from .sanitize import InvalidDiagram
from .sysmodel import SCHEMA_HINT, validate_model

FORMATS = ('mermaid', 'svg')  # default view: Mermaid, or ELK auto-layout SVG

SYSTEM_PROMPT = (
    'You are a software architect. Model the described system as structured JSON; it will be '
    'rendered as an architecture diagram. Respond ONLY with a JSON object: '
    '{"title": str, "explanation": str, "model": MODEL} where MODEL is ' + SCHEMA_HINT + '. '
    'Use groups for tiers, networks, cloud accounts and trust boundaries (kind "trust_zone" for '
    'security boundaries such as public internet vs private network); nest them with "parent". '
    'Ids are short alphanumeric (e.g. "api", "orders_db"); labels are human readable. '
    'Edge style: "sync" for request/response calls, "async" for events/messages, "data" for '
    'replication or bulk data flow. Keep it readable: at most ~25 nodes. '
    'When modifying an existing model, keep the ids of unchanged components stable. '
    'If given an existing diagram as Mermaid or SVG instead of a model, convert it to a model. '
    '"explanation" is 1-3 sentences.'
)


class HarnessError(RuntimeError):
    pass


@dataclass
class Result:
    title: str
    explanation: str
    code: str
    repairs: int
    model: dict | None = None


def get_client():
    try:
        return get_llm()
    except LLMConfigError as e:
        raise HarnessError(str(e))


def _complete(client, messages) -> str:
    return client.complete(messages)


def _extract_json(raw: str):
    """Models without a JSON mode may wrap the object in prose or fences."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find('{'), raw.rfind('}')
        if start == -1 or end <= start:
            raise
        return json.loads(raw[start:end + 1])


def _parse(raw: str) -> Result:
    try:
        data = _extract_json(raw)
        value = data['model']
    except (json.JSONDecodeError, KeyError, TypeError):
        raise InvalidDiagram('Response must be a JSON object with a "model" field')
    model = validate_model(value)
    return Result(str(data.get('title', ''))[:200], str(data.get('explanation', '')),
                  to_mermaid(model), 0, model)


def _previous_turn(code: str, model: dict | None) -> str:
    """How the current diagram is shown to the model when repairing."""
    if model:
        return json.dumps({'title': '', 'explanation': '', 'model': model})
    return json.dumps({'title': '', 'explanation': '', 'code': code})


def _run(client, messages: list, max_repairs: int, repairs_used: int = 0) -> Result:
    last_error = None
    for attempt in range(max_repairs + 1):
        raw = _complete(client, messages)
        try:
            result = _parse(raw)
            result.repairs = repairs_used + attempt
            return result
        except InvalidDiagram as e:
            last_error = e
            messages = messages + [
                {'role': 'assistant', 'content': raw},
                {'role': 'user', 'content': f'That output was invalid: {e}. Return a corrected JSON object.'},
            ]
    raise HarnessError(f'Could not produce a valid diagram: {last_error}')


def generate(prompt: str, previous_code: str | None = None,
             previous_model: dict | None = None, client=None) -> Result:
    client = client or get_client()
    if previous_model:
        prompt = f'Current system model:\n{json.dumps(previous_model)}\n\nModify it as follows: {prompt}'
    elif previous_code:
        # versions made before the system model existed: converted while editing
        prompt = f'Current diagram:\n{previous_code}\n\nModify it as follows: {prompt}'
    messages = [{'role': 'system', 'content': SYSTEM_PROMPT}, {'role': 'user', 'content': prompt}]
    return _run(client, messages, settings.HARNESS_MAX_REPAIRS)


def repair(prompt: str, code: str, error: str, model: dict | None = None, client=None) -> Result:
    """Feed a renderer error (reported by the browser) back to the model."""
    client = client or get_client()
    messages = [
        {'role': 'system', 'content': SYSTEM_PROMPT},
        {'role': 'user', 'content': prompt},
        {'role': 'assistant', 'content': _previous_turn(code, model)},
        {'role': 'user', 'content': f'The renderer rejected this diagram with: {error[:1500]}\n'
                                    'Fix it and return the full corrected JSON object.'},
    ]
    return _run(client, messages, settings.HARNESS_MAX_REPAIRS, repairs_used=1)
