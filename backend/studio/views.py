import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import harness
from .models import Diagram, DiagramVersion

MAX_PROMPT = 4000


def _version(v):
    return {'number': v.number, 'prompt': v.prompt, 'code': v.code,
            'explanation': v.explanation, 'repairs': v.repairs,
            'created_at': v.created_at.isoformat()}


def _diagram(d, with_versions=True):
    out = {'id': d.id, 'title': d.title, 'format': d.format, 'updated_at': d.updated_at.isoformat()}
    if with_versions:
        out['versions'] = [_version(v) for v in d.versions.all()]
    return out


def _body(request):
    try:
        data = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        raise ValueError('Invalid JSON')
    if not isinstance(data, dict):
        raise ValueError('Body must be a JSON object')
    return data


def _save_version(diagram, prompt, result):
    last = diagram.latest()
    DiagramVersion.objects.create(
        diagram=diagram, number=(last.number + 1) if last else 1, prompt=prompt,
        code=result.code, explanation=result.explanation, repairs=result.repairs)
    if result.title and not diagram.title:
        diagram.title = result.title
    diagram.save()
    return diagram


def _run(fn):
    try:
        return fn()
    except ValueError as e:
        return JsonResponse({'error': str(e)}, status=400)
    except harness.HarnessError as e:
        return JsonResponse({'error': str(e)}, status=502)
    except Exception as e:  # upstream API failures (network, auth, rate limit)
        return JsonResponse({'error': f'Model request failed: {type(e).__name__}'}, status=502)


@csrf_exempt  # local dev API consumed by the Vite proxy; add auth before exposing publicly
@require_http_methods(['GET'])
def diagram_list(request):
    return JsonResponse({'diagrams': [_diagram(d, False) for d in Diagram.objects.all()[:100]]})


@csrf_exempt
@require_http_methods(['GET'])
def diagram_detail(request, pk):
    try:
        return JsonResponse(_diagram(Diagram.objects.get(pk=pk)))
    except Diagram.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)


@csrf_exempt
@require_http_methods(['POST'])
def generate(request):
    def go():
        data = _body(request)
        prompt = str(data.get('prompt', '')).strip()
        fmt = data.get('format', 'mermaid')
        if not prompt or len(prompt) > MAX_PROMPT:
            raise ValueError(f'prompt is required (max {MAX_PROMPT} chars)')
        if fmt not in harness.SYSTEM_PROMPTS:
            raise ValueError('format must be "mermaid" or "svg"')
        diagram, previous = None, None
        if data.get('diagram_id'):
            try:
                diagram = Diagram.objects.get(pk=data['diagram_id'])
            except (Diagram.DoesNotExist, ValueError, TypeError):
                raise ValueError('Unknown diagram_id')
            fmt = diagram.format
            previous = diagram.latest().code
        result = harness.generate(prompt, fmt, previous)
        diagram = diagram or Diagram.objects.create(format=fmt)
        return JsonResponse(_diagram(_save_version(diagram, prompt, result)))
    return _run(go)


@csrf_exempt
@require_http_methods(['POST'])
def repair(request, pk):
    """Browser reports a render error for the latest version; model fixes it."""
    def go():
        try:
            diagram = Diagram.objects.get(pk=pk)
        except Diagram.DoesNotExist:
            raise ValueError('Unknown diagram')
        error = str(_body(request).get('error', '')).strip()
        if not error:
            raise ValueError('error is required')
        latest = diagram.latest()
        result = harness.repair(latest.prompt, diagram.format, latest.code, error)
        return JsonResponse(_diagram(_save_version(diagram, f'(auto-repair) {error[:120]}', result)))
    return _run(go)
