import json
from pathlib import Path

INCIDENTS = Path('monitoring-history/seo-incidents.json')
RECOVERY = Path('monitoring-history/seo-recovery.json')
REPORT = Path('monitoring-report/recovery.json')
MARKDOWN = Path('monitoring-report/SEO-RECOVERY.md')


def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def action_for(item):
    metrics = set(item.get('metrics', []))
    severity = item.get('severity', 'info')
    path = item.get('path')
    target = f" for `{path}`" if path else ''

    if 'available' in metrics:
        return f'Restore availability{target}: verify deployment, hosting response, DNS/HTTPS and upstream dependencies; then re-run production SEO checks.'
    if 'canonical_ok' in metrics:
        return f'Repair canonical integrity{target}: verify the canonical URL matches the production URL exactly, then validate indexability and JSON-LD.'
    if 'noindex' in metrics:
        return f'Remove the unexpected noindex signal{target}: inspect HTML/meta and response headers, then confirm the page is crawlable and indexable.'
    if 'response_time_ms' in metrics or 'avg_response_time_ms' in metrics:
        return f'Recover performance{target}: inspect server timing, page dependencies and recent deployment changes; confirm latency returns toward baseline before closing the incident.'
    if 'jsonld_pages' in metrics:
        return 'Restore structured-data coverage: identify pages missing JSON-LD, validate schema syntax and re-run the authority/SEO guard.'
    if severity == 'critical':
        return f'Perform priority recovery{target}: inspect the latest deployment and production response before changing content.'
    return f'Investigate and verify the signal{target}; avoid content changes until the infrastructure cause is understood.'


def recovery_state(current):
    active = current.get('incidents', [])
    if any(x.get('priority') == 'P1' for x in active):
        return 'critical_recovery'
    if active:
        return 'recovery_required'
    if current.get('resolved_incident_count', 0):
        return 'verification'
    return 'stable'


def main():
    history = load_json(INCIDENTS, [])
    current = history[-1] if history else {}
    previous = history[-2] if len(history) >= 2 else {}
    active = current.get('incidents', [])
    previous_active = {x.get('dedupe_key') for x in previous.get('incidents', [])}

    plans = []
    for item in active:
        plans.append({
            'dedupe_key': item.get('dedupe_key'),
            'priority': item.get('priority'),
            'severity': item.get('severity'),
            'scope': item.get('scope'),
            'path': item.get('path'),
            'action': action_for(item),
            'verification': 'Run SEO monitoring, robots/sitemap audit and page-level canonical/indexability checks after remediation.',
            'status': 'active' if item.get('dedupe_key') in previous_active else 'new',
        })

    state = recovery_state(current)
    record = {
        'timestamp': current.get('timestamp'),
        'source_incident_snapshot': current.get('timestamp'),
        'state': state,
        'active_incident_count': len(active),
        'recovery_plan_count': len(plans),
        'resolved_incident_count': current.get('resolved_incident_count', 0),
        'plans': plans,
    }

    recovery_history = load_json(RECOVERY, [])
    recovery_history.append(record)
    recovery_history = recovery_history[-30:]
    RECOVERY.parent.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    RECOVERY.write_text(json.dumps(recovery_history, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    REPORT.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    lines = [
        '# SEO 3.4 — Recovery Intelligence',
        '',
        f"Snapshot: `{record['timestamp']}`",
        f"State: **{state}**",
        f"Active incidents: **{len(active)}**",
        f"Recovery plans: **{len(plans)}**",
        f"Resolved incidents: **{record['resolved_incident_count']}**",
        '',
    ]
    if plans:
        lines += ['## Recovery plan', '']
        for plan in plans:
            lines.append(f"- **{plan['priority']} / {plan['severity'].upper()}** — {plan['status'].upper()} — {plan['action']} Verification: {plan['verification']}")
    elif state == 'verification':
        lines += ['## Verification', '', 'Incidents have resolved; run the next production monitoring cycle to confirm recovery remains stable.', '']
    else:
        lines += ['## Recovery plan', '', 'No active recovery actions required. Production intelligence is stable.', '']

    MARKDOWN.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False))


if __name__ == '__main__':
    main()
