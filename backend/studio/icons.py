"""Server-side fetch + disk cache for cloud icon artwork (see shared/cloud_icons.json).

Only catalogue keys are served, so this is not an open proxy: the URL always comes from
the catalogue, never from the request. Artwork is sanitized like model-produced SVG.
"""
import urllib.request

from django.conf import settings

from .sanitize import InvalidDiagram, sanitize_svg
from .sysmodel import ICONS

MAX_BYTES = 300_000
TIMEOUT = 10


class IconUnavailable(Exception):
    pass


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'diagram-studio/1.0'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        if 'svg' not in resp.headers.get('Content-Type', ''):
            raise IconUnavailable('not an SVG')
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise IconUnavailable('too large')
    return data


def get_icon(key: str) -> str:
    """Sanitized SVG for a catalogue key. Raises KeyError (unknown) or IconUnavailable."""
    url = ICONS[key]['img']
    if not url:
        raise IconUnavailable('no artwork for this icon')
    cache = settings.ICON_CACHE_DIR / (key.replace(':', '__') + '.svg')
    if cache.exists():
        return cache.read_text()
    try:
        svg = sanitize_svg(_download(url).decode('utf-8'))
    except (OSError, UnicodeDecodeError, InvalidDiagram) as e:  # network errors are OSErrors
        raise IconUnavailable(str(e))
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(svg)
    return svg
