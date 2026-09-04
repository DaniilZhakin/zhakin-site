import json
from pathlib import Path

RECOVERY = Path('monitoring-report/recovery.json')
MONITORING = Path('monitoring-report/seo-monitoring.json')
INCIDENTS = Path('monitoring-report/incidents.json')
VERIFICATION = Path('monitoring-report/recovery-verification.json')
MARKDOWN = Path('monitoring-report/SEO-RECOVERY-VERIFICATION.md')


def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def main():
    recovery = load_json(RECOVERY, {})
    monitoring = load_json(MONITORING, {})
    incidents = load_json(INCIDENTS, {})

    summary = monitoring.get('summary', {})
    failed = int(summary.get('failed', 0) or 0)
    warnings = int(summary.get('warning', 0) or 0)
    active_incidents = int(incidents.get('incident_count', 0) or 0)
    recovery_state = recovery.get('state', 'unknown')

    if failed:
        verification_state = 'failed'
        verdict = 'Recovery not verified: production SEO monitoring still reports failed checks.'
    elif active_incidents:
        verification_state = 'pending'
        verdict = 'Recovery pending: production checks pass, but correlated incidents remain active.'
    elif recovery_state in {'verification', 'recovery_required', 'critical_recovery'}:
        verification_state = 'verified'
        verdict = 'Recovery verified: production SEO checks pass and no active correlated incidents remain.'
    else:
        verification_state = 'stable'
        verdict = 'Stable: production SEO checks pass and the recovery layer reports no active recovery requirement.'

    record = {
        'timestamp': monitoring.get('site'),
        'recovery_state': recovery_state,
        'verification_state': verification_state,
        'verdict': verdict,
        'monitoring_summary': {
            'ok': int(summary.get('ok', 0) or 0),
            'warning': warnings,
            'failed': failed,
        },
        'active_incident_count': active_incidents,
        'recovery_plan_count': int(recovery.get('recovery_plan_count', 0) or 0),
    }

    VERIFICATION.parent.mkdir(parents=True, exist_ok=True)
    VERIFICATION.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    lines = [
        '# SEO 3.5 — Automated Recovery Verification',
        '',
        f"Verification state: **{verification_state}**",
        f"Recovery state: **{recovery_state}**",
        f"Active incidents: **{active_incidents}**",
        f"Recovery plans: **{record['recovery_plan_count']}**",
        f"Monitoring: OK={record['monitoring_summary']['ok']} WARNING={warnings} FAILED={failed}",
        '',
        f"**Verdict:** {verdict}",
        '',
    ]
    MARKDOWN.write_text('\n'.join(lines), encoding='utf-8')

    if verification_state == 'failed':
        raise SystemExit(verdict)
    print(json.dumps(record, ensure_ascii=False))


if __name__ == '__main__':
    main()
