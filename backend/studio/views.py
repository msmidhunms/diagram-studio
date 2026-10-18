import json

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import harness, icons
from .models import Diagram, DiagramVersion
from .sysmodel import diff_models

MAX_PROMPT = 4000


def _version(v, prev=None):
    return {'number': v.number, 'prompt': v.prompt, 'code': v.code, 'model': v.model,
            'changes': diff_models(prev.model, v.model) if prev else None,
            'explanation': v.explanation, 'repairs': v.repairs, 'review': v.review,
            'created_at': v.created_at.isoformat()}


def _diagram(d, with_versions=True):
    out = {'id': d.id, 'title': d.title, 'format': d.format, 'updated_at': d.updated_at.isoformat()}
    if with_versions:
        versions = list(d.versions.all())
        out['versions'] = [_version(v, versions[i - 1] if i else None) for i, v in enumerate(versions)]
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
        code=result.code, model=result.model, explanation=result.explanation, repairs=result.repairs,
        review=result.review)
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
@require_http_methods(['GET', 'PATCH', 'DELETE'])
def diagram_detail(request, pk):
    try:
        diagram = Diagram.objects.get(pk=pk)
    except Diagram.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)
    if request.method == 'DELETE':
        diagram.delete()
        return JsonResponse({'deleted': pk})
    if request.method == 'PATCH':
        try:
            title = str(_body(request).get('title', '')).strip()[:200]
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=400)
        if not title:
            return JsonResponse({'error': 'title is required'}, status=400)
        diagram.title = title
        diagram.save()
    return JsonResponse(_diagram(diagram))


@csrf_exempt
@require_http_methods(['POST'])
def generate(request):
    def go():
        data = _body(request)
        prompt = str(data.get('prompt', '')).strip()
        fmt = data.get('format', 'mermaid')
        if not prompt or len(prompt) > MAX_PROMPT:
            raise ValueError(f'prompt is required (max {MAX_PROMPT} chars)')
        if fmt not in harness.FORMATS:
            raise ValueError('format must be "mermaid" or "svg"')
        diagram, previous = None, None
        if data.get('diagram_id'):
            try:
                diagram = Diagram.objects.get(pk=data['diagram_id'])
            except (Diagram.DoesNotExist, ValueError, TypeError):
                raise ValueError('Unknown diagram_id')
            fmt = diagram.format
            previous = diagram.latest()
        result = harness.generate(prompt, previous.code if previous else None,
                                  previous.model if previous else None)
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
        result = harness.repair(latest.prompt, latest.code, error, latest.model)
        return JsonResponse(_diagram(_save_version(diagram, f'(auto-repair) {error[:120]}', result)))
    return _run(go)


@require_http_methods(['GET'])
def icon(request, key):
    """Cloud icon artwork for the Auto-layout view, e.g. /api/icons/aws:lambda.svg"""
    try:
        svg = icons.get_icon(key)
    except KeyError:
        return JsonResponse({'error': 'Unknown icon'}, status=404)
    except icons.IconUnavailable as e:
        return JsonResponse({'error': f'Icon unavailable: {e}'}, status=502)
    resp = HttpResponse(svg, content_type='image/svg+xml')
    resp['Cache-Control'] = 'public, max-age=86400'
    resp['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'"
    return resp
