import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

INCIDENTS = Path('monitoring-history/seo-incidents.json')
RECOVERY = Path('monitoring-report/recovery.json')
VERIFICATION = Path('monitoring-report/recovery-verification.json')
ORCHESTRATOR = Path('monitoring-report/recovery-orchestrator.json')
MARKDOWN = Path('monitoring-report/SEO-RECOVERY-ORCHESTRATOR.md')
HISTORY = Path('monitoring-history/seo-recovery-history.json')
MAX_HISTORY = 50

ALLOWED_TRANSITIONS = {
    'START': {'RECOVERED', 'DETECTED', 'CORRELATED'},
    'DETECTED': {'RECOVERY_REQUIRED', 'RECOVERED', 'ESCALATE', 'DRY_RUN'},
    'CORRELATED': {'RECOVERY_REQUIRED', 'RECOVERED', 'ESCALATE', 'DRY_RUN'},
    'RECOVERY_REQUIRED': {'VERIFYING', 'ESCALATE', 'DRY_RUN'},
    'VERIFYING': {'RECOVERED', 'ESCALATE'},
    'RECOVERED': set(),
    'ESCALATE': set(),
    'DRY_RUN': set(),
}


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


def transition(state, next_state):
    if next_state not in ALLOWED_TRANSITIONS.get(state, set()):
        raise RuntimeError(f'Invalid orchestrator state transition: {state} -> {next_state}')
    return next_state


def append_history(record):
    history = load_json(HISTORY, [])
    if not isinstance(history, list):
        history = []
    history.append({
        'timestamp': record['timestamp'],
        'fingerprint': record['fingerprint'],
        'state': record['state'],
        'action': record['action'],
        'escalation_required': record['escalation_required'],
        'dry_run': record['dry_run'],
    })
    HISTORY.parent.mkdir(parents=True, exist_ok=True)
    HISTORY.write_text(json.dumps(history[-MAX_HISTORY:], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    incident = load_json(INCIDENTS, [])
    current_incident = incident[-1] if incident else {}
    recovery = load_json(RECOVERY, {})
    verification = load_json(VERIFICATION, {})
    active = current_incident.get('incidents', [])
    verification_failed = bool(verification) and verification.get('failed_check_count', 0) > 0
    detection = bool(active) or verification_failed
    dry_run = os.getenv('DRY_RUN', '').strip().lower() in {'1', 'true', 'yes', 'on'}
    current_fingerprint = fingerprint(current_incident, verification)
    history = load_json(HISTORY, [])
    if not isinstance(history, list):
        history = []
    previous = [x for x in history if x.get('fingerprint') == current_fingerprint]
    previous_terminal = previous[-1] if previous and previous[-1].get('state') in {'RECOVERED', 'ESCALATE'} else None

    state = 'START'
    action = 'NONE'
    reason = ''
    commands = []

    if not detection:
        state = transition(state, 'RECOVERED')
        reason = 'No active correlated incidents and production verification is healthy.'
    elif dry_run:
        state = 'DETECTED' if not active else 'CORRELATED'
        state = transition(state, 'DRY_RUN')
        action = 'SIMULATE_ONLY'
        reason = 'DRY_RUN is enabled; no recovery scripts or production changes were executed.'
    elif previous_terminal:
        state = transition('DETECTED' if not active else 'CORRELATED', previous_terminal['state'])
        action = 'NONE' if state == 'RECOVERED' else 'CORRECTIVE_ISSUE_REQUIRED'
        reason = (
            f"Recovery loop protection: fingerprint {current_fingerprint} already reached terminal state "
            f"{previous_terminal['state']}; automatic recovery will not repeat."
        )
    else:
        state = 'DETECTED' if not active else 'CORRELATED'
        if verification_failed:
            state = transition(state, 'RECOVERY_REQUIRED')
            action = 'SAFE_REPAIR'
            reason = 'Production verification failed; only deterministic monitoring-artifact repair is permitted automatically.'
        elif active:
            state = transition(state, 'RECOVERY_REQUIRED')
            action = 'SAFE_REPAIR'
            reason = 'Correlated SEO incident requires deterministic safe repair and verification.'

        commands.append(run_script('intelligence/seo-recovery-intelligence.py'))
        state = transition(state, 'VERIFYING')
        verification_run = run_script('intelligence/seo-recovery-verification.py')
        commands.append(verification_run)
        verification = load_json(VERIFICATION, verification)
        if verification_run['returncode'] == 0 and verification.get('failed_check_count', 0) == 0:
            state = transition(state, 'RECOVERED')
            action = 'RECOVERED'
            reason = 'Safe repair regenerated deterministic recovery artifacts and production verification passed.'
        else:
            state = transition(state, 'ESCALATE')
            action = 'CORRECTIVE_ISSUE_REQUIRED'
            reason = 'Safe repair did not restore production health. No site content was modified.'

    timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    record = {
        'timestamp': timestamp,
        'orchestrator': 'SEO Intelligence 3.6.1',
        'state': state,
        'action': action,
        'reason': reason,
        'incident_snapshot': current_incident.get('timestamp'),
        'verification_timestamp': verification.get('timestamp'),
        'verification_state': verification.get('verification_state'),
        'fingerprint': current_fingerprint,
        'dry_run': dry_run,
        'state_machine_guard': 'ENABLED',
        'recovery_loop_protection': {
            'enabled': True,
            'history_file': str(HISTORY),
            'previous_terminal_state': previous_terminal.get('state') if previous_terminal else None,
        },
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
    append_history(record)

    lines = [
        '# SEO 3.6.1 — Self-Healing / Recovery Orchestrator Hardening',
        '',
        f"State: **{state}**",
        f"Action: **{action}**",
        f"Fingerprint: `{record['fingerprint']}`",
        f"DRY_RUN: **{dry_run}**",
        '',
        f"**Decision:** {reason}",
        '',
        '## Hardening',
        '',
        '- State Machine Guard rejects invalid state transitions.',
        '- Recovery Loop Protection prevents repeated automatic recovery for the same terminal fingerprint.',
        '- Recovery History keeps the last 50 orchestration decisions for auditability.',
        '- `DRY_RUN=1` evaluates the decision path without executing repair scripts.',
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
