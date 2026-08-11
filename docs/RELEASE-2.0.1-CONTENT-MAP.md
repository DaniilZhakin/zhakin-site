# Release 2.0.1 — Content Map & URL Architecture

## Purpose

Define the canonical content map and URL strategy for the next stage of the official website while preserving the 1.9.0 production baseline.

## URL Principles

- Keep existing production URLs stable.
- Prefer short, descriptive, lowercase paths for new pages.
- Use one canonical URL per substantive page.
- Do not create thin duplicate pages solely for SEO.
- Every new indexable page must have a clear purpose, title, description, canonical and internal-link path.

## Existing Production Surface

| Content | Canonical path | Role |
|---|---|---|
| Official homepage | `/` | Primary authority and navigation hub |
| Strategic projects | `/projects.html` | Project overview |

Existing homepage anchors remain stable and are treated as sections rather than duplicate URLs.

## Proposed Content Map

### Official Profile

- `/about.html` — authoritative profile, biography, professional positioning and verified roles.
- Homepage `#about` remains the primary summary entry point.

### International Activities

- `/international.html` — international cooperation, export activity, strategic development and related work.
- Homepage `#international` remains the summary entry point.

### Strategic Projects

- `/projects.html` — existing canonical project hub.
- Future project detail pages should use `/projects/<slug>.html` only when a project has sufficient original, verified content.

### Publications & Analytics

- `/publications.html` — future editorial hub for analytical articles, expert publications and media materials.
- Future individual articles should use `/publications/<slug>.html` when they warrant an independent indexable page.

### ООО «ПОБЕДА»

- `/pobeda.html` — dedicated corporate information and project direction.
- Corporate claims must remain distinct from the personal profile.

### Благотворительный фонд «УСЕРДИЕ»

- `/userdie.html` — dedicated social-impact direction, mission and verified programs.
- Existing homepage `#userdie` remains a navigation entry point.

### Contacts

- `/contacts.html` — professional, international, media and project communication routes.
- Homepage `#contacts` remains a direct entry point.

## Internal Linking Model

Homepage → all primary sections/pages.

Projects → relevant project details → relevant organization/project owner.

Publications → related projects, international activity and verified profile information.

Organization pages → relevant projects and publications without conflating organizational identity with personal identity.

## SEO / Structured Data Rules

- Canonical URLs must match the final production URL.
- New structured data must describe visible page content.
- Use Person, Organization, Brand, Article and BreadcrumbList only where semantically appropriate.
- Do not introduce unsupported claims, fake reviews, ratings or invented affiliations.

## Implementation Sequence

1. Keep 1.9.0 production unchanged.
2. Build content/page templates only after the map is approved.
3. Implement one page at a time.
4. Add sitemap entries only for published indexable pages.
5. Run SEO, accessibility, responsive, link and production QA after each meaningful addition.

## Acceptance Criteria

The content map is complete when every proposed page has a defined purpose, canonical path, relationship to existing navigation and clear publication criteria.
