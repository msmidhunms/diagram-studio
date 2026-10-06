"""Validation/sanitization of untrusted LLM output."""
import re
import xml.etree.ElementTree as ET

SVG_NS = 'http://www.w3.org/2000/svg'
FORBIDDEN_TAGS = {'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set'}
MAX_BYTES = 200_000


class InvalidDiagram(ValueError):
    pass


def strip_fences(text: str) -> str:
    m = re.search(r'```(?:\w+)?\s*\n(.*?)```', text, re.DOTALL)
    return (m.group(1) if m else text).strip()


def _local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1].lower()


def sanitize_svg(code: str) -> str:
    code = strip_fences(code)
    if len(code.encode()) > MAX_BYTES:
        raise InvalidDiagram('SVG too large')
    if re.search(r'<!(DOCTYPE|ENTITY)', code, re.IGNORECASE):
        raise InvalidDiagram('DOCTYPE/ENTITY declarations are not allowed')
    ET.register_namespace('', SVG_NS)
    try:
        root = ET.fromstring(code)
    except ET.ParseError as e:
        raise InvalidDiagram(f'SVG is not well-formed XML: {e}')
    if _local(root.tag) != 'svg':
        raise InvalidDiagram('Root element must be <svg>')
    if 'xmlns' not in code.split('>', 1)[0] and not root.tag.startswith('{'):
        root.tag = f'{{{SVG_NS}}}svg'

    for parent in list(root.iter()):
        for child in list(parent):
            if _local(child.tag) in FORBIDDEN_TAGS:
                parent.remove(child)
    for el in root.iter():
        for attr in list(el.attrib):
            name = _local(attr)
            val = el.attrib[attr].strip().lower()
            if name.startswith('on'):
                del el.attrib[attr]
            elif name == 'href' and not val.startswith('#'):
                del el.attrib[attr]  # no external refs or javascript: URLs
            elif name == 'style' and ('url(' in val or 'javascript' in val or 'expression' in val):
                del el.attrib[attr]
    if root.get('viewBox') is None and not (root.get('width') and root.get('height')):
        raise InvalidDiagram('SVG needs a viewBox (or width and height)')
    return ET.tostring(root, encoding='unicode')


MERMAID_STARTS = (
    'graph', 'flowchart', 'sequencediagram', 'classdiagram', 'statediagram', 'erdiagram',
    'journey', 'gantt', 'pie', 'mindmap', 'timeline', 'gitgraph', 'c4context', 'c4container',
    'c4component', 'c4dynamic', 'c4deployment', 'architecture', 'block', 'quadrantchart',
    'requirementdiagram', 'sankey', 'xychart', 'packet', 'kanban',
)


def check_mermaid(code: str) -> str:
    """Cheap structural check; real syntax validation happens in the browser renderer,
    which reports parse errors back to /repair."""
    code = strip_fences(code)
    if code.startswith('---'):  # YAML frontmatter
        parts = code.split('---', 2)
        code = parts[2].strip() if len(parts) == 3 else code
    body = [l for l in code.splitlines() if l.strip() and not l.strip().startswith('%%')]
    if not body:
        raise InvalidDiagram('Empty Mermaid diagram')
    first = body[0].strip().lower()
    if not first.startswith(MERMAID_STARTS):
        raise InvalidDiagram(f'Mermaid must start with a diagram type keyword, got: {body[0][:40]!r}')
    if len(code) > MAX_BYTES:
        raise InvalidDiagram('Mermaid too large')
    return code
