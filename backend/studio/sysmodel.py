"""The structured system model: the single source of truth for a diagram.

The LLM produces this JSON ("plan"); renderers turn it into Mermaid, SVG, etc. ("render").
Because rendering is deterministic, layouts stay consistent across edits and versions can
be diffed by component instead of by text.

Shape:
  {"direction": "LR" | "TD",
   "groups": [{"id", "label", "kind", "parent"?}],
   "nodes":  [{"id", "label", "type", "group"?, "tech"?, "icon"?}],
   "edges":  [{"from", "to", "label"?, "style"?}]}
"""
import json
import re
from pathlib import Path

from .sanitize import InvalidDiagram

# Cloud service icons ("aws:lambda", "azure:cosmos_db", ...), shared with the frontend
ICONS_FILE = Path(__file__).resolve().parents[2] / 'shared' / 'cloud_icons.json'
ICONS = json.loads(ICONS_FILE.read_text())['icons']

NODE_TYPES = ('service', 'database', 'cache', 'queue', 'storage', 'client', 'user',
              'external', 'gateway', 'function', 'other')
GROUP_KINDS = ('tier', 'trust_zone', 'network', 'cloud', 'other')
EDGE_STYLES = ('sync', 'async', 'data')
DIRECTIONS = ('LR', 'TD')
MAX_NODES, MAX_EDGES, MAX_GROUPS, MAX_LABEL = 80, 200, 30, 100

SCHEMA_HINT = (
    '{"direction": "LR"|"TD", '
    '"groups": [{"id": str, "label": str, "kind": "tier"|"trust_zone"|"network"|"cloud"|"other", "parent": group id (optional)}], '
    '"nodes": [{"id": str, "label": str, "type": "' + '"|"'.join(NODE_TYPES) + '", '
    '"group": group id (optional), "tech": str (optional, e.g. "PostgreSQL 16"), '
    '"icon": cloud icon key (optional, see below)}], '
    '"edges": [{"from": node id, "to": node id, "label": str (optional), "style": "sync"|"async"|"data"}]}'
)


def icon_catalogue() -> str:
    """Compact list of icon keys for the prompt, e.g. 'aws: lambda, ec2, ...'."""
    by_provider = {}
    for key in ICONS:
        provider, service = key.split(':')
        by_provider.setdefault(provider, []).append(service)
    return '; '.join(f'{p}: {", ".join(s)}' for p, s in by_provider.items())


def _icon(value):
    key = str(value or '').strip().lower().replace(' ', '_')
    return key if key in ICONS else None  # unknown icons are dropped, not an error


def _id(value, what):
    s = re.sub(r'[^A-Za-z0-9_]', '_', str(value or '').strip())[:40]
    if not s:
        raise InvalidDiagram(f'{what} is missing an "id"')
    return s


def _text(value, limit=MAX_LABEL):
    return ' '.join(str(value or '').split())[:limit]


def _list(model, key, limit):
    items = model.get(key, [])
    if items is None:
        return []
    if not isinstance(items, list):
        raise InvalidDiagram(f'"{key}" must be a list')
    if len(items) > limit:
        raise InvalidDiagram(f'Too many {key} ({len(items)}); keep it under {limit}')
    if not all(isinstance(i, dict) for i in items):
        raise InvalidDiagram(f'Every item in "{key}" must be an object')
    return items


def validate_model(model) -> dict:
    """Check and normalize an LLM-produced model. Raises InvalidDiagram with a message
    specific enough to feed back to the model for repair."""
    if not isinstance(model, dict):
        raise InvalidDiagram('"model" must be a JSON object')

    groups, gids = [], set()
    for g in _list(model, 'groups', MAX_GROUPS):
        gid = _id(g.get('id'), 'A group')
        if gid in gids:
            raise InvalidDiagram(f'Duplicate group id "{gid}"')
        gids.add(gid)
        kind = g.get('kind') if g.get('kind') in GROUP_KINDS else 'other'
        groups.append({'id': gid, 'label': _text(g.get('label')) or gid, 'kind': kind,
                       'parent': _id(g['parent'], 'parent') if g.get('parent') else None})
    for g in groups:
        if g['parent'] and g['parent'] not in gids:
            raise InvalidDiagram(f'Group "{g["id"]}" has unknown parent "{g["parent"]}"')
    parents = {g['id']: g['parent'] for g in groups}
    for gid in parents:  # reject parent cycles
        seen, cur = set(), gid
        while cur:
            if cur in seen:
                raise InvalidDiagram(f'Group "{gid}" is nested inside itself')
            seen.add(cur)
            cur = parents[cur]

    nodes, nids = [], set()
    raw_nodes = _list(model, 'nodes', MAX_NODES)
    if not raw_nodes:
        raise InvalidDiagram('"nodes" must contain at least one node')
    for n in raw_nodes:
        nid = _id(n.get('id'), 'A node')
        if nid in nids or nid in gids:
            raise InvalidDiagram(f'Duplicate id "{nid}" (node and group ids must be unique)')
        nids.add(nid)
        group = _id(n['group'], 'group') if n.get('group') else None
        if group and group not in gids:
            raise InvalidDiagram(f'Node "{nid}" references unknown group "{group}"')
        nodes.append({'id': nid, 'label': _text(n.get('label')) or nid,
                      'type': n.get('type') if n.get('type') in NODE_TYPES else 'other',
                      'group': group, 'tech': _text(n.get('tech'), 60) or None,
                      'icon': _icon(n.get('icon'))})

    edges = []
    for e in _list(model, 'edges', MAX_EDGES):
        src, dst = _id(e.get('from'), 'Edge "from"'), _id(e.get('to'), 'Edge "to"')
        for end in (src, dst):
            if end not in nids:
                raise InvalidDiagram(f'Edge {src} -> {dst} references unknown node "{end}"')
        edges.append({'from': src, 'to': dst, 'label': _text(e.get('label'), 60) or None,
                      'style': e.get('style') if e.get('style') in EDGE_STYLES else 'sync'})

    direction = str(model.get('direction', 'LR')).upper()
    return {'direction': direction if direction in DIRECTIONS else 'LR',
            'groups': groups, 'nodes': nodes, 'edges': edges}


def diff_models(old: dict | None, new: dict | None) -> dict | None:
    """Component-level change summary between two versions (None if either has no model)."""
    if not old or not new:
        return None
    on, nn = {n['id']: n for n in old['nodes']}, {n['id']: n for n in new['nodes']}
    key = lambda e: f"{e['from']}->{e['to']}"  # noqa: E731
    oe, ne = {key(e): e for e in old['edges']}, {key(e): e for e in new['edges']}
    fields = ('label', 'type', 'group', 'tech', 'icon')
    return {
        'added_nodes': [nn[i]['label'] for i in nn if i not in on],
        'removed_nodes': [on[i]['label'] for i in on if i not in nn],
        'changed_nodes': [nn[i]['label'] for i in nn if i in on
                          and any(on[i].get(f) != nn[i].get(f) for f in fields)],
        'added_edges': [k for k in ne if k not in oe],
        'removed_edges': [k for k in oe if k not in ne],
    }
