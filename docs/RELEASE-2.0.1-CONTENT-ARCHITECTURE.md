# Release 2.0.1 — Content Architecture & Authority Layer

## Purpose

Establish the information architecture for the next stage of the official website without changing the stable production baseline.

## Production Baseline

- Repository: `DaniilZhakin/zhakin-site`
- Baseline release: `1.9.0`
- Baseline commit: `b81fbc57d88d66e94785e902c8e442e0b6b1d057`
- Rule: completed 1.8.x–1.9.0 functionality is not to be refactored without an objective reason.

## Content Architecture

### 1. Official Profile

The authoritative personal profile and professional positioning of Daniil Zhakin.

### 2. International Activities

A dedicated content layer for international cooperation, export activity, strategic development and related professional work.

### 3. Strategic Projects

A structured presentation of business, investment, infrastructure and social projects.

### 4. Publications & Analytics

The future content hub for analytical articles, expert publications, media appearances and selected external publications.

### 5. ООО «ПОБЕДА»

A dedicated business direction with clear separation between corporate information and personal profile content.

### 6. Благотворительный фонд «УСЕРДИЕ»

A dedicated social-impact direction preserving its independent identity and mission.

### 7. Contacts

A clear point of contact for professional, international, media and project-related communication.

## Authority Layer

The next implementation phase should strengthen the semantic relationships between:

- Person — Daniil Zhakin
- Brand — ZHAKIN TEAM
- Organization — ООО «ПОБЕДА»
- Organization — Благотворительный фонд «УСЕРДИЕ»
- Projects — strategic initiatives
- Publications — analytical and media materials

## Implementation Order

1. Preserve production baseline.
2. Finalize page/content map.
3. Define canonical URLs for new content.
4. Extend internal linking only where useful.
5. Extend structured data only where supported by visible page content.
6. Build the Publications / Analytics content layer.
7. Validate SEO, accessibility, responsive behavior and performance after each meaningful change.

## Non-Goals

- No redesign of the existing production UI at this stage.
- No unnecessary framework migration.
- No repetition of completed SEO/accessibility/performance releases.
- No publication of unverified biographical or organizational claims.

## Acceptance Criteria

Release 2.0.1 is complete when the content architecture is reflected in the repository documentation and the first implementation slice is ready without regression against the 1.9.0 production baseline.
