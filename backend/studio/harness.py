"""LLM harness: prompt -> structured diagram, with a validate-and-repair loop.

Mermaid ("plan, then render"): the model returns {title, explanation, model} where
`model` is a structured system model (see sysmodel.py); it is validated and rendered to
Mermaid deterministically. SVG: the model returns {title, explanation, code} with a
hand-drawn SVG, which is sanitized.

On invalid output the error is fed back to the model for a bounded number of repair
attempts. Browser-side render errors can be fed back the same way through `repair()`.
"""
import json
from dataclasses import dataclass

from django.conf import settings

from .llm import LLMConfigError, get_llm
from .render_mermaid import to_mermaid
from .sanitize import InvalidDiagram, sanitize_svg
from .sysmodel import SCHEMA_HINT, validate_model

SYSTEM_PROMPTS = {
    'mermaid': (
        'You are a software architect. Model the described system as structured JSON; it will be '
        'rendered as an architecture diagram. Respond ONLY with a JSON object: '
        '{"title": str, "explanation": str, "model": MODEL} where MODEL is ' + SCHEMA_HINT + '. '
        'Use groups for tiers, networks, cloud accounts and trust boundaries (kind "trust_zone" for '
        'security boundaries such as public internet vs private network); nest them with "parent". '
        'Ids are short alphanumeric (e.g. "api", "orders_db"); labels are human readable. '
        'Edge style: "sync" for request/response calls, "async" for events/messages, "data" for '
        'replication or bulk data flow. Keep it readable: at most ~25 nodes. '
        'When modifying an existing model, keep the ids of unchanged components stable. '
        '"explanation" is 1-3 sentences.'
    ),
    'svg': (
        'You are a software architect that draws system architecture diagrams as SVG. '
        'Respond ONLY with a JSON object: {"title": str, "explanation": str, "code": str}. '
        '"code" is a complete standalone <svg> with xmlns and a viewBox (e.g. 0 0 960 600). '
        'Use only rect, line, path, circle, text, g, defs, marker, polygon. No scripts, no external '
        'references, no foreignObject. Use rounded rects for components, arrows via marker-end, '
        'text-anchor="middle" labels sized to fit inside boxes, a light background rect, and a '
        'consistent palette. Group related components in labelled containers. '
        '"explanation" is 1-3 sentences.'
    ),
}


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


def _parse(fmt: str, raw: str) -> Result:
    field = 'model' if fmt == 'mermaid' else 'code'
    try:
        data = _extract_json(raw)
        value = data[field]
    except (json.JSONDecodeError, KeyError, TypeError):
        raise InvalidDiagram(f'Response must be a JSON object with a "{field}" field')
    title, explanation = str(data.get('title', ''))[:200], str(data.get('explanation', ''))
    if fmt == 'mermaid':
        model = validate_model(value)
        return Result(title, explanation, to_mermaid(model), 0, model)
    if not isinstance(value, str):
        raise InvalidDiagram('"code" must be a string')
    return Result(title, explanation, sanitize_svg(value), 0)


def _previous_turn(fmt: str, code: str, model: dict | None) -> str:
    """How the current diagram is shown to the model when iterating or repairing."""
    if fmt == 'mermaid' and model:
        return json.dumps({'title': '', 'explanation': '', 'model': model})
    return json.dumps({'title': '', 'explanation': '', 'code': code})


def _run(client, fmt: str, messages: list, max_repairs: int, repairs_used: int = 0) -> Result:
    last_error = None
    for attempt in range(max_repairs + 1):
        raw = _complete(client, messages)
        try:
            result = _parse(fmt, raw)
            result.repairs = repairs_used + attempt
            return result
        except InvalidDiagram as e:
            last_error = e
            messages = messages + [
                {'role': 'assistant', 'content': raw},
                {'role': 'user', 'content': f'That output was invalid: {e}. Return a corrected JSON object.'},
            ]
    raise HarnessError(f'Could not produce a valid {fmt} diagram: {last_error}')


def generate(prompt: str, fmt: str, previous_code: str | None = None,
             previous_model: dict | None = None, client=None) -> Result:
    client = client or get_client()
    messages = [{'role': 'system', 'content': SYSTEM_PROMPTS[fmt]}]
    if previous_model and fmt == 'mermaid':
        current = f'Current system model:\n{json.dumps(previous_model)}'
    elif previous_code:
        # older Mermaid versions have no model yet: the model converts the code while editing
        current = f'Current diagram:\n{previous_code}'
    else:
        current = None
    if current:
        prompt = f'{current}\n\nModify it as follows (return the full updated result): {prompt}'
    messages.append({'role': 'user', 'content': prompt})
    return _run(client, fmt, messages, settings.HARNESS_MAX_REPAIRS)


def repair(prompt: str, fmt: str, code: str, error: str, model: dict | None = None, client=None) -> Result:
    """Feed a renderer error (reported by the browser) back to the model."""
    client = client or get_client()
    messages = [
        {'role': 'system', 'content': SYSTEM_PROMPTS[fmt]},
        {'role': 'user', 'content': prompt},
        {'role': 'assistant', 'content': _previous_turn(fmt, code, model)},
        {'role': 'user', 'content': f'The renderer rejected this diagram with: {error[:1500]}\n'
                                    'Fix it and return the full corrected JSON object.'},
    ]
    return _run(client, fmt, messages, settings.HARNESS_MAX_REPAIRS, repairs_used=1)
