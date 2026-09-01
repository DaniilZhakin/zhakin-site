# SEO 2.4 — Robots Layer

Date: 2026-09-02

## Objective

Introduce an automated crawler/SEO integrity guard without changing the established production information architecture.

## Implemented

GitHub Actions workflow: `.github/workflows/seo-robots-audit.yml`

The guard runs:

- on every push to `main`;
- weekly on Monday at 04:17 UTC;
- manually via GitHub Actions.

## Controls

### 1. robots.txt

Verifies the production crawler policy:

- `User-agent: *`
- `Allow: /`
- production sitemap declaration.

### 2. Sitemap

Verifies:

- exactly 14 production URLs;
- no duplicate URLs;
- all URLs use the production domain;
- all 10 publication pages are present;
- core pages are present.

### 3. Canonical and indexability

Verifies every core/publication HTML page has a canonical link and contains no unexpected `noindex` or `X-Robots-Tag` signal.

### 4. Authority graph

Verifies the established `#person` and `#website` anchors remain present across the core and publication pages.

## Safety principle

This layer is a **guardian**, not an automatic content editor. It does not rewrite production pages, modify sitemap dates, or alter visible content. A failed check stops the workflow and surfaces the defect for review.

## Result

Robots Layer 2.4 is implemented as an automated integrity control. The existing production SEO architecture remains unchanged by the guard itself.
