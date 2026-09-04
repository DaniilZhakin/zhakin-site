import json
from pathlib import Path

ANOMALIES = Path('monitoring-history/seo-anomalies.json')
INCIDENTS = Path('monitoring-history/seo-incidents.json')
REPORT = Path('monitoring-report/incidents.json')
MARKDOWN = Path('monitoring-report/SEO-INCIDENTS.md')

SEVERITY_WEIGHT = {'critical': 100, 'warning': 60, 'info': 20}


def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def scope_weight(item):
    return 25 if item.get('scope') == 'aggregate' else 10


def normalize_key(item):
    path = item.get('path', 'aggregate')
    metric = item.get('metric', 'unknown')
    return f"{path}:{metric}"


def correlate(history):
    if not history:
        return []
    latest = history[-1]
    anomalies = latest.get('anomalies', [])
    if not anomalies:
        return []

    groups = {}
    for item in anomalies:
        key = normalize_key(item)
        groups.setdefault(key, []).append(item)

    # Correlate page failures and latency into one incident per affected page.
    page_groups = {}
    aggregate = []
    for key, items in groups.items():
        if items[0].get('scope') == 'page':
            page = items[0].get('path', 'unknown')
            page_groups.setdefault(page, []).extend(items)
        else:
            aggregate.extend(items)

    incidents = []
    for page, items in sorted(page_groups.items()):
        severities = [x.get('severity', 'info') for x in items]
        severity = max(severities, key=lambda x: SEVERITY_WEIGHT.get(x, 0))
        metrics = sorted({x.get('metric', 'unknown') for x in items})
        persistence = max(1, len(items))
        score = min(100, SEVERITY_WEIGHT.get(severity, 20) + scope_weight(items[0]) + min(25, persistence * 8))
        priority = 'P1' if severity == 'critical' else ('P2' if score >= 70 else 'P3')
        incidents.append({
            'id': f'page:{page}',
            'priority': priority,
            'severity': severity,
            'scope': 'page',
            'path': page,
            'metrics': metrics,
            'signal_count': len(items),
            'score': score,
            'dedupe_key': f'page:{page}',
            'recommended_action': 'Inspect availability, canonical/noindex headers and recent deployment changes before making content edits.' if severity == 'critical' else 'Inspect server timing, page dependencies and recent deployment changes; confirm whether latency persists.'
        })

    if aggregate:
        severity = max((x.get('severity', 'info') for x in aggregate), key=lambda x: SEVERITY_WEIGHT.get(x, 0))
        metrics = sorted({x.get('metric', 'unknown') for x in aggregate})
        score = min(100, SEVERITY_WEIGHT.get(severity, 20) + 25 + min(25, len(aggregate) * 8))
        priority = 'P1' if severity == 'critical' else ('P2' if score >= 70 else 'P3')
        incidents.append({
            'id': 'aggregate:seo-health',
            'priority': priority,
            'severity': severity,
            'scope': 'aggregate',
            'metrics': metrics,
            'signal_count': len(aggregate),
            'score': score,
            'dedupe_key': 'aggregate:seo-health',
            'recommended_action': 'Review the latest SEO health snapshot and identify whether the regression is infrastructure-wide or concentrated on specific pages.'
        })

    return sorted(incidents, key=lambda x: (-x['score'], x['id']))


def main():
    history = load_json(ANOMALIES, [])
    latest = history[-1] if history else {}
    incidents = correlate(history)

    previous = load_json(INCIDENTS, [])
    previous_keys = {x.get('dedupe_key') for x in previous[-1].get('incidents', [])} if previous else set()
    current_keys = {x.get('dedupe_key') for x in incidents}
    for item in incidents:
        item['new'] = item['dedupe_key'] not in previous_keys
    resolved = sorted(previous_keys - current_keys)

    record = {
        'timestamp': latest.get('timestamp'),
        'source_history_points': len(history),
        'incident_count': len(incidents),
        'new_incident_count': sum(1 for x in incidents if x.get('new')),
        'resolved_incident_count': len(resolved),
        'incidents': incidents,
        'resolved_dedupe_keys': resolved,
    }

    history.append(record)
    history = history[-30:]
    INCIDENTS.parent.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    INCIDENTS.write_text(json.dumps(history, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    REPORT.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    lines = ['# SEO 3.3 — Correlated Incident Intelligence', '', f"Snapshot: `{record['timestamp']}`", f"Incidents: **{record['incident_count']}**", f"New: **{record['new_incident_count']}**", f"Resolved: **{record['resolved_incident_count']}**", '']
    if incidents:
        lines += ['## Active incidents', '']
        for item in incidents:
            target = f" — `{item['path']}`" if item.get('path') else ''
            marker = ' NEW' if item.get('new') else ''
            lines.append(f"- **{item['priority']} / {item['severity'].upper()}**{marker} — score {item['score']}{target} — {', '.join(item['metrics'])}. {item['recommended_action']}")
    else:
        lines += ['## Active incidents', '', 'No correlated incidents detected.', '']
    if resolved:
        lines += ['## Resolved', ''] + [f'- `{key}`' for key in resolved]
    MARKDOWN.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False))


if __name__ == '__main__':
    main()
