from pathlib import Path
import re

# Publication context trigger: keep the generator active on every publication graph change.
ROOT = Path(__file__).resolve().parents[1]
PUBLICATIONS = ROOT / "publications"

GROUPS = {
    "finance": ("Финансы и инвестиции", [
        "money-financial-system.html", "digital-ruble.html", "ai-financial-system.html", "price-discovery.html"
    ]),
    "ai": ("AI и государство", ["ai-parliament.html", "ai-infrastructure.html"]),
    "law": ("Право и институты", ["understanding-state-and-law.html", "legal-architecture.html"]),
    "infra": ("Инфраструктура и экономика", ["food-infrastructure.html"]),
    "strategy": ("Стратегическое развитие", [
        "economic-transition-1990s.html", "future-without-money.html", "intellectual-economy.html", "capital-requires-proof.html"
    ])
}

MARKER = '<div class="publication-context" data-publication-context="v1">'


def title_from_html(text: str) -> str:
    m = re.search(r'<title>(.*?)</title>', text, re.S | re.I)
    if not m:
        return "Материал"
    return re.sub(r'\s+—\s+Даниил Жакин\s*$', '', m.group(1).strip())


def build_block(filename: str, group_id: str) -> str:
    label, members = GROUPS[group_id]
    related = [item for item in members if item != filename]
    links = []
    for item in related:
        text = title_from_html((PUBLICATIONS / item).read_text(encoding="utf-8"))
        links.append(f'<a href="/publications/{item}">{text} →</a>')
    links_html = "<br><br>".join(links)
    return (
        f'{MARKER}\n'
        f'<div class="publication-context-label">Аналитическое направление</div>\n'
        f'<div class="publication-context-direction">{label}</div>\n'
        f'<div class="publication-context-links">{links_html}</div>\n'
        f'<a class="publication-context-map" href="/publications/directions.html">Открыть аналитическую карту →</a>\n'
        f'<a class="publication-context-index" href="/publications.html?direction={group_id}">Все материалы направления →</a>\n'
        f'</div>'
    )


def inject(text: str, block: str) -> str:
    if 'data-publication-context="v1"' in text:
        return text
    footer_marker = '<footer>'
    if footer_marker not in text:
        raise RuntimeError("footer marker not found")
    css = '''<style id="publication-context-style">.publication-context{margin:54px 0 0;padding:26px 28px;background:linear-gradient(135deg,#112720,#0b1916);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:12px}.publication-context-label{color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.publication-context-direction{margin-top:7px;color:var(--gold,#ead9aa);font-size:21px;font-weight:700}.publication-context-links{margin-top:18px;color:var(--muted)}.publication-context-links a,.publication-context-map,.publication-context-index{display:block;color:var(--gold,#ead9aa);text-decoration:none}.publication-context-links a:hover,.publication-context-map:hover,.publication-context-index:hover{color:var(--accent)}.publication-context-map,.publication-context-index{margin-top:18px;font-size:13px;font-weight:700}@media(max-width:720px){.publication-context{padding:22px 20px}.publication-context-direction{font-size:19px}}</style>'''
    if 'id="publication-context-style"' not in text:
        text = text.replace('</style></head>', '</style>' + css + '</head>', 1)
    return text.replace(footer_marker, block + footer_marker, 1)


changed = []
for group_id, (_, members) in GROUPS.items():
    for filename in members:
        path = PUBLICATIONS / filename
        text = path.read_text(encoding="utf-8")
        updated = inject(text, build_block(filename, group_id))
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed.append(str(path.relative_to(ROOT)))

print("updated", len(changed))
for item in changed:
    print(item)
