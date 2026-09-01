# SEO 2.1 — Authority Graph Audit

## Status

**Completed: 2026-09-02**

## Scope

Control audit of the production semantic graph after the Publications authority-layer rollout.

## Verified architecture

- Canonical production origin: `https://xn--80alhhq.xn--p1ai/`
- Stable Person identifier: `https://xn--80alhhq.xn--p1ai/#person`
- Stable WebSite identifier: `https://xn--80alhhq.xn--p1ai/#website`
- Publications collection: `https://xn--80alhhq.xn--p1ai/publications.html#webpage`
- 10 first-party publication pages represented in the Publications ItemList.
- 14 production URLs represented in the sitemap.

## Publication-level graph

Each normalized publication connects:

`Article → Person → Publications Collection → WebSite`

with `author` and `publisher` pointing to the canonical Person, `isPartOf` pointing to the Publications collection, `mainEntityOfPage` pointing to the publication WebPage, `isBasedOn` pointing to the original external publication where applicable, WebPage `isPartOf` pointing to the canonical WebSite, WebPage `about` pointing to the canonical Person, BreadcrumbList identifying the page hierarchy, and `dateModified` reflecting the latest semantic synchronization.

## Findings

1. The Publications authority graph is structurally consistent across the current first-party publication layer.
2. Sitemap and publication modification dates are synchronized with the latest authority-layer changes.
3. No new sitemap URLs are required at this stage.
4. No `noindex` or `X-Robots-Tag` directive was introduced by the current SEO layer.
5. The homepage and profile pages use the same canonical WebSite/Person identifiers, providing a stable entity anchor for internal semantic links.

## Guardrails

- Do not add speculative `sameAs` identities without verified official profiles.
- Do not duplicate Person nodes under different identifiers.
- Do not create additional publication URLs solely for SEO.
- Do not modify the visual system unless a separate UX requirement exists.
- Revalidate structured data after every meaningful semantic change.

## Next implementation target

Strengthen the site-level entity graph connecting the canonical Person, ZHAKIN TEAM, strategic projects, ООО «ПОБЕДА», Благотворительный фонд «УСЕРДИЕ» and the Publications layer, using only relationships supported by visible content.
