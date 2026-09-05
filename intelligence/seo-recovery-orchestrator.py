import hashlib
import json
import subprocess
import time
from pathlib import Path

INCIDENTS = Path('monitoring-history/seo-incidents.json')
RECOVERY = Path('monitoring-report/recovery.json')
VERIFICATION = Path('monitoring-report/recovery-verification.json')
ORCHESTRATOR = Path('monitoring-report/recovery-orchestrator.json')
MARKDOWN = Path('monitoring-report/SEO-RECOVERY-ORCHESTRATOR.md')


def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return default


def run_script(path):
    result = subprocess.run(['python3', path], text=True, capture_output=True)
    return {
        'script': path,
        'returncode': result.returncode,
        'stdout': result.stdout.strip()[-4000:],
        'stderr': result.stderr.strip()[-4000:],
    }


def fingerprint(incident, verification):
    payload = json.dumps({
        'incidents': incident.get('incidents', []),
        'failed_check_count': verification.get('failed_check_count', 0),
        'failed_checks': [x.get('name') for x in verification.get('checks', []) if not x.get('ok')],
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]


def main():
    incident = load_json(INCIDENTS, [])
    current_incident = incident[-1] if incident else {}
    recovery = load_json(RECOVERY, {})
    verification = load_json(VERIFICATION, {})
    active = current_incident.get('incidents', [])
    verification_failed = bool(verification) and verification.get('failed_check_count', 0) > 0
    detection = bool(active) or verification_failed

    if not detection:
        state = 'RECOVERED'
        action = 'NONE'
        reason = 'No active correlated incidents and production verification is healthy.'
        commands = []
    else:
        state = 'DETECTED'
        action = 'CORRELATE'
        reason = 'Production signal or correlated SEO incident requires recovery handling.'
        commands = []
        if active:
            state = 'CORRELATED'
            action = 'RECOVERY_REQUIRED'
            reason = f'{len(active)} correlated incident(s) supplied by SEO Intelligence 3.3/3.4.'
        if verification_failed:
            state = 'RECOVERY_REQUIRED'
            action = 'SAFE_REPAIR'
            reason = 'Production verification failed; only deterministic monitoring-artifact repair is permitted automatically.'

            commands.append(run_script('intelligence/seo-recovery-intelligence.py'))
            state = 'VERIFYING'
            verification_run = run_script('intelligence/seo-recovery-verification.py')
            commands.append(verification_run)
            verification = load_json(VERIFICATION, verification)
            if verification_run['returncode'] == 0 and verification.get('failed_check_count', 0) == 0:
                state = 'RECOVERED'
                action = 'RECOVERED'
                reason = 'Safe repair regenerated deterministic recovery artifacts and production verification passed.'
            else:
                state = 'ESCALATE'
                action = 'CORRECTIVE_ISSUE_REQUIRED'
                reason = 'Safe repair did not restore production health. No site content was modified.'
        elif active:
            state = 'RECOVERY_REQUIRED'
            action = 'SAFE_REPAIR'
            commands.append(run_script('intelligence/seo-recovery-intelligence.py'))
            state = 'VERIFYING'
            verification_run = run_script('intelligence/seo-recovery-verification.py')
            commands.append(verification_run)
            verification = load_json(VERIFICATION, verification)
            if verification_run['returncode'] == 0 and verification.get('failed_check_count', 0) == 0:
                state = 'RECOVERED'
                action = 'RECOVERED'
                reason = 'Safe repair completed without touching production content and verification passed.'
            else:
                state = 'ESCALATE'
                action = 'CORRECTIVE_ISSUE_REQUIRED'
                reason = 'Safe repair did not restore production health. No site content was modified.'

    record = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'orchestrator': 'SEO Intelligence 3.6',
        'state': state,
        'action': action,
        'reason': reason,
        'incident_snapshot': current_incident.get('timestamp'),
        'verification_timestamp': verification.get('timestamp'),
        'verification_state': verification.get('verification_state'),
        'fingerprint': fingerprint(current_incident, verification),
        'safe_repair_policy': {
            'allowed': [
                'regenerate deterministic monitoring/recovery reports',
                'rerun production verification',
            ],
            'forbidden': [
                'modify production HTML/content',
                'modify publication text',
                'modify canonical targets without explicit corrective review',
                'change robots/sitemap production content automatically',
            ],
        },
        'commands': commands,
        'escalation_required': state == 'ESCALATE',
    }

    ORCHESTRATOR.parent.mkdir(parents=True, exist_ok=True)
    ORCHESTRATOR.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = [
        '# SEO 3.6 — Self-Healing / Recovery Orchestrator',
        '',
        f"State: **{state}**",
        f"Action: **{action}**",
        f"Fingerprint: `{record['fingerprint']}`",
        '',
        f"**Decision:** {reason}",
        '',
        '## Safety policy',
        '',
        '- Automatic repair is limited to deterministic monitoring/recovery artifacts and verification reruns.',
        '- Production HTML, publication text, canonical targets, robots.txt and sitemap.xml are never modified by the orchestrator.',
        '- Persistent production failure escalates to a corrective GitHub Issue; content changes require review.',
        '',
    ]
    MARKDOWN.write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False))
    return 1 if state == 'ESCALATE' else 0


if __name__ == '__main__':
    raise SystemExit(main())
