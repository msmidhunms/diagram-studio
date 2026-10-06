"""LLM harness: prompt -> structured diagram, with a validate-and-repair loop.

The model is asked for a JSON object {title, explanation, code}. Output is validated
(and sanitized for SVG); on failure the error is fed back to the model for a bounded
number of repair attempts. Browser-side Mermaid parse errors can be fed back the same
way through `repair()`.
"""
import json
from dataclasses import dataclass

from django.conf import settings

from .llm import LLMConfigError, get_llm
from .sanitize import InvalidDiagram, check_mermaid, sanitize_svg

SYSTEM_PROMPTS = {
    'mermaid': (
        'You are a software architect that draws system architecture diagrams as Mermaid. '
        'Respond ONLY with a JSON object: {"title": str, "explanation": str, "code": str}. '
        '"code" is raw Mermaid source (no code fences). Prefer `flowchart TD` or `flowchart LR` '
        'with subgraphs for tiers/boundaries; use sequenceDiagram only for request flows. '
        'Quote any node label containing parentheses, slashes or punctuation, e.g. A["API (v2)"]. '
        'Use short alphanumeric node ids. Keep it readable: at most ~25 nodes. '
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
    try:
        data = _extract_json(raw)
        code = data['code']
    except (json.JSONDecodeError, KeyError, TypeError):
        raise InvalidDiagram('Response must be a JSON object with a "code" string field')
    if not isinstance(code, str):
        raise InvalidDiagram('"code" must be a string')
    code = sanitize_svg(code) if fmt == 'svg' else check_mermaid(code)
    return Result(str(data.get('title', ''))[:200], str(data.get('explanation', '')), code, 0)


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


def generate(prompt: str, fmt: str, previous_code: str | None = None, client=None) -> Result:
    client = client or get_client()
    messages = [{'role': 'system', 'content': SYSTEM_PROMPTS[fmt]}]
    if previous_code:
        messages.append({'role': 'user', 'content': f'Current diagram:\n{previous_code}\n\nModify it as follows (return the full updated diagram): {prompt}'})
    else:
        messages.append({'role': 'user', 'content': prompt})
    return _run(client, fmt, messages, settings.HARNESS_MAX_REPAIRS)


def repair(prompt: str, fmt: str, code: str, error: str, client=None) -> Result:
    """Feed a renderer error (reported by the browser) back to the model."""
    client = client or get_client()
    messages = [
        {'role': 'system', 'content': SYSTEM_PROMPTS[fmt]},
        {'role': 'user', 'content': prompt},
        {'role': 'assistant', 'content': json.dumps({'title': '', 'explanation': '', 'code': code})},
        {'role': 'user', 'content': f'The renderer rejected this diagram with: {error[:1500]}\nFix the syntax and return the full corrected JSON object.'},
    ]
    return _run(client, fmt, messages, settings.HARNESS_MAX_REPAIRS, repairs_used=1)
