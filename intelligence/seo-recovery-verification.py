import json
import re
import subprocess
import time
from pathlib import Path

RECOVERY = Path('monitoring-report/recovery.json')
VERIFICATION = Path('monitoring-report/recovery-verification.json')
MARKDOWN = Path('monitoring-report/SEO-RECOVERY-VERIFICATION.md')
SITE = 'https://xn--80alhhq.xn--p1ai'


def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def fetch(url):
    started = time.monotonic()
    last_error = ''
    for attempt in range(3):
        result = subprocess.run(
            ['curl', '-L', '--fail-with-body', '--silent', '--show-error', '--max-time', '20', '-D', '-', url],
            text=True, capture_output=True,
        )
        if result.returncode == 0:
            parts = re.split(r'\r?\n\r?\n', result.stdout, maxsplit=1)
            headers = parts[0]
            body = parts[1] if len(parts) > 1 else ''
            if body:
                elapsed_ms = round((time.monotonic() - started) * 1000)
                return headers, body, elapsed_ms, ''
        last_error = result.stderr.strip() or f'curl exited with code {result.returncode}'
        if attempt < 2:
            time.sleep(2 * (attempt + 1))
    elapsed_ms = round((time.monotonic() - started) * 1000)
    return '', '', elapsed_ms, last_error


def main():
    recovery = load_json(RECOVERY, {})
    checks = []

    headers, robots, elapsed, err = fetch(SITE + '/robots.txt')
    checks.append({'name': 'robots.txt', 'ok': bool(robots and 'Allow: /' in robots and SITE + '/sitemap.xml' in robots), 'response_time_ms': elapsed, 'error': err})

    headers, sitemap, elapsed, err = fetch(SITE + '/sitemap.xml')
    urls = re.findall(r'<loc>(.*?)</loc>', sitemap)
    checks.append({'name': 'sitemap.xml', 'ok': bool(urls and len(urls) == len(set(urls)) and all(u.startswith(SITE + '/') or u == SITE + '/' for u in urls)), 'response_time_ms': elapsed, 'url_count': len(urls), 'error': err})

    core_pages = [
        '/', '/about.html', '/projects.html', '/publications.html', '/reception.html', '/institutional.html',
    ]
    strategic_pages = [
        '/political-analysis.html', '/political-objects.html', '/political-object.html',
        '/political-methodology.html', '/political-map.html', '/political-timeline.html',
    ]
    publication_paths = sorted({
        url.replace(SITE, '', 1)
        for url in urls
        if url.startswith(SITE + '/publications/') and url.endswith('.html')
    })
    required = core_pages + strategic_pages + [path for path in publication_paths if path not in core_pages and path not in strategic_pages]
    missing = [SITE + path for path in required if SITE + path not in urls]
    checks.append({'name': 'sitemap coverage', 'ok': not missing, 'missing': missing})

    page_failures = []
    for path in required:
        url = SITE + path
        headers, html, elapsed, err = fetch(url)
        canonical = re.findall(r'<link\b(?=[^>]*\brel=["\']canonical["\'])(?=[^>]*\bhref=["\']([^"\']+))[^>]*>', html, flags=re.I)
        canonical_ok = bool(canonical and canonical[0].rstrip('/') == url.rstrip('/'))
        noindex = bool(re.search(r'<meta[^>]+name=["\']robots["\'][^>]+content=["\'][^"\']*noindex', html, flags=re.I)) or bool(re.search(r'X-Robots-Tag:\s*[^\r\n]*noindex', headers, flags=re.I))
        schema_ok = bool(re.search(r'application/ld\+json', html, flags=re.I))
        ok = bool(html and canonical_ok and not noindex and schema_ok)
        if not ok:
            page_failures.append({'url': url, 'error': err or 'canonical/indexability/JSON-LD verification failed', 'response_time_ms': elapsed})

    checks.append({'name': 'page SEO signals', 'ok': not page_failures, 'failed_pages': page_failures})
    failed = [item for item in checks if not item['ok']]
    recovery_state = recovery.get('state', 'unknown')
    verification_state = 'failed' if failed else ('verified' if recovery_state != 'stable' else 'stable')
    verdict = ('Recovery not verified: production checks failed.' if failed else 'Recovery verified: production SEO surface is healthy.' if verification_state == 'verified' else 'Stable: production SEO surface is healthy.')

    record = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'site': SITE,
        'recovery_state': recovery_state,
        'verification_state': verification_state,
        'verdict': verdict,
        'checks': checks,
        'failed_check_count': len(failed),
    }
    VERIFICATION.parent.mkdir(parents=True, exist_ok=True)
    VERIFICATION.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = ['# SEO 3.5 — Automated Recovery Verification', '', f"Site: {SITE}", f"Verification: **{verification_state}**", f"Recovery state: **{recovery_state}**", '', f"**Verdict:** {verdict}", '']
    for item in checks:
        lines.append(f"- {'PASS' if item['ok'] else 'FAIL'} — {item['name']}")
    MARKDOWN.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    if failed:
        raise SystemExit(verdict)
    print(json.dumps(record, ensure_ascii=False))


if __name__ == '__main__':
    main()
