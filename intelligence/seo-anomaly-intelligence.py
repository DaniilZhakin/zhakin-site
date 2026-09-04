import json
from pathlib import Path
from statistics import mean

HISTORY = Path('monitoring-history/seo-history.json')
ANOMALIES = Path('monitoring-history/seo-anomalies.json')
REPORT = Path('monitoring-report/anomalies.json')
MARKDOWN = Path('monitoring-report/SEO-ANOMALIES.md')


def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def classify_persistent(history):
    if not history:
        return [], []

    recent = history[-5:]
    anomalies = []
    warnings = []
    latest = recent[-1]
    prev = recent[-2] if len(recent) >= 2 else None

    # Aggregate persistence: a degradation must be present in at least two
    # consecutive snapshots before it is considered persistent.
    if len(recent) >= 3:
        avgs = [x.get('signals', {}).get('avg_response_time_ms') for x in recent]
        avgs = [x for x in avgs if isinstance(x, (int, float))]
        if len(avgs) >= 3:
            rising = avgs[-1] > avgs[-2] > avgs[-3]
            materially_high = avgs[-1] >= max(800, avgs[-3] * 1.5)
            if rising and materially_high:
                anomalies.append({
                    'id': 'aggregate-response-time-persistent',
                    'severity': 'warning',
                    'scope': 'aggregate',
                    'metric': 'avg_response_time_ms',
                    'values': avgs[-3:],
                    'message': 'Average response time has deteriorated across three consecutive snapshots.'
                })

    # Page-level persistence: availability/indexability regressions or a
    # sustained latency spike across consecutive snapshots.
    paths = set(latest.get('pages', {}))
    if prev:
        paths |= set(prev.get('pages', {}))
    older = recent[-3] if len(recent) >= 3 else None

    for path in sorted(paths):
        cur = latest.get('pages', {}).get(path, {})
        p = prev.get('pages', {}).get(path, {}) if prev else {}
        o = older.get('pages', {}).get(path, {}) if older else {}

        if prev and cur.get('available') is False and p.get('available') is False:
            anomalies.append({'id': f'{path}:availability', 'severity': 'critical', 'scope': 'page', 'path': path, 'metric': 'available', 'message': 'Page has been unavailable in two consecutive snapshots.'})
        if prev and cur.get('canonical_ok') is False and p.get('canonical_ok') is False:
            anomalies.append({'id': f'{path}:canonical', 'severity': 'critical', 'scope': 'page', 'path': path, 'metric': 'canonical_ok', 'message': 'Canonical validation has failed in two consecutive snapshots.'})
        if prev and cur.get('noindex') is True and p.get('noindex') is True:
            anomalies.append({'id': f'{path}:noindex', 'severity': 'critical', 'scope': 'page', 'path': path, 'metric': 'noindex', 'message': 'Unexpected noindex has persisted for two consecutive snapshots.'})

        if older:
            vals = [o.get('response_time_ms'), p.get('response_time_ms'), cur.get('response_time_ms')]
            if all(isinstance(v, (int, float)) for v in vals):
                sustained = vals[2] > vals[1] > vals[0]
                high = vals[2] >= max(1000, vals[0] * 1.5) and vals[2] - vals[0] >= 250
                if sustained and high:
                    anomalies.append({'id': f'{path}:latency', 'severity': 'warning', 'scope': 'page', 'path': path, 'metric': 'response_time_ms', 'values': vals, 'message': 'Page response time has increased across three consecutive snapshots.'})

    if prev:
        cur_signals = latest.get('signals', {})
        prev_signals = prev.get('signals', {})
        for metric in ('available_pages', 'canonical_ok_pages', 'jsonld_pages'):
            if cur_signals.get(metric, 0) < prev_signals.get(metric, 0):
                warnings.append({'id': f'aggregate:{metric}', 'severity': 'info', 'metric': metric, 'message': f'{metric} decreased since the previous snapshot; persistence has not yet been established.'})

    return anomalies, warnings


def main():
    history = load_json(HISTORY, [])
    persistent, transient = classify_persistent(history)
    now = history[-1].get('timestamp') if history else None

    record = {
        'timestamp': now,
        'history_points': len(history),
        'persistent_anomaly_count': len(persistent),
        'transient_signal_count': len(transient),
        'anomalies': persistent,
        'transient_signals': transient,
    }

    anomaly_history = load_json(ANOMALIES, [])
    anomaly_history.append(record)
    anomaly_history = anomaly_history[-30:]
    ANOMALIES.parent.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    ANOMALIES.write_text(json.dumps(anomaly_history, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    REPORT.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    lines = ['# SEO 3.2 — Persistent Anomaly Intelligence', '', f'Snapshot: `{now}`', f'History points: **{len(history)}**', f'Persistent anomalies: **{len(persistent)}**', f'Transient signals: **{len(transient)}**', '']
    if persistent:
        lines += ['## Persistent anomalies', '']
        for item in persistent:
            lines.append(f"- **{item['severity'].upper()}** — {item['message']}" + (f" (`{item['path']}`)" if item.get('path') else ''))
    else:
        lines += ['## Persistent anomalies', '', 'No persistent anomaly detected.', '']
    if transient:
        lines += ['## Signals awaiting persistence', '']
        for item in transient:
            lines.append(f"- **INFO** — {item['message']}")
    MARKDOWN.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False))


if __name__ == '__main__':
    main()
