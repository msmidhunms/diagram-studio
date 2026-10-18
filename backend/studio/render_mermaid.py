"""Deterministic system model -> Mermaid flowchart renderer."""

# node type -> (open, close) Mermaid shape delimiters
SHAPES = {
    'database': ('[(', ')]'),
    'storage': ('[(', ')]'),
    'cache': ('{{', '}}'),
    'queue': ('[[', ']]'),
    'client': ('([', '])'),
    'user': ('([', '])'),
    'external': ('[/', '/]'),
    'gateway': ('[/', '\\]'),
    'function': ('(', ')'),
}
ARROWS = {'sync': '-->', 'async': '-.->', 'data': '==>'}
CLASSES = {
    'database': 'fill:#e8f1fb,stroke:#3b6ea5',
    'storage': 'fill:#e8f1fb,stroke:#3b6ea5',
    'cache': 'fill:#fdf1e3,stroke:#c07a2c',
    'queue': 'fill:#f3ecfa,stroke:#7d55a8',
    'external': 'fill:#f2f2f2,stroke:#777,stroke-dasharray:4 3',
    'client': 'fill:#eaf6ee,stroke:#3f8a57',
    'user': 'fill:#eaf6ee,stroke:#3f8a57',
}
GROUP_STYLES = {
    'trust_zone': 'fill:transparent,stroke:#c0392b,stroke-width:2px,stroke-dasharray:6 4',
    'network': 'fill:transparent,stroke:#7f8c8d,stroke-dasharray:3 3',
    'cloud': 'fill:#f7fbff,stroke:#5b8bd0',
}


def _q(text: str) -> str:
    # Mermaid entity codes keep quotes and brackets from breaking the syntax
    return '"' + text.replace('"', '#quot;').replace('<', '#lt;').replace('>', '#gt;') + '"'


def _nid(i):  # prefixes avoid Mermaid keywords such as `end` or `graph`
    return f'n_{i}'


def _gid(i):
    return f'g_{i}'


def to_mermaid(model: dict) -> str:
    lines = [f"flowchart {model['direction']}"]
    children, members = {}, {}
    for g in model['groups']:
        children.setdefault(g['parent'], []).append(g)
    for n in model['nodes']:
        members.setdefault(n['group'], []).append(n)

    def node_line(n, pad):
        label = _q(n['label'])
        if n['tech']:  # second line for the technology, e.g. "PostgreSQL 16"
            label = label[:-1] + '<br/>' + _q(n['tech'])[1:]
        o, c = SHAPES.get(n['type'], ('[', ']'))
        return f'{pad}{_nid(n["id"])}{o}{label}{c}'

    def emit(parent, depth):
        pad = '  ' * depth
        for n in members.get(parent, []):
            lines.append(node_line(n, pad))
        for g in children.get(parent, []):
            lines.append(f'{pad}subgraph {_gid(g["id"])}[{_q(g["label"])}]')
            emit(g['id'], depth + 1)
            lines.append(f'{pad}end')

    emit(None, 1)
    for e in model['edges']:
        arrow = ARROWS[e['style']]
        label = f'|{_q(e["label"])}|' if e['label'] else ''
        lines.append(f'  {_nid(e["from"])} {arrow}{label} {_nid(e["to"])}')

    used = {n['type'] for n in model['nodes']}
    for t, style in CLASSES.items():
        if t in used:
            lines.append(f'  classDef {t} {style}')
    for n in model['nodes']:
        if n['type'] in CLASSES:
            lines.append(f'  class {_nid(n["id"])} {n["type"]}')
    for g in model['groups']:
        if g['kind'] in GROUP_STYLES:
            lines.append(f'  style {_gid(g["id"])} {GROUP_STYLES[g["kind"]]}')
    return '\n'.join(lines)
