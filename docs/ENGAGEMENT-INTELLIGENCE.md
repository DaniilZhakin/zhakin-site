# Engagement Intelligence — 2.9

## Purpose

2.9 extends the privacy-first Audience Intelligence foundation into an engagement layer. The site records meaningful interaction signals without collecting identity, IP addresses, fingerprints, message contents, or other personally identifiable data.

## Current event model

- `page_view` — page opened;
- `navigation_click` — navigation target selected;
- `menu_toggle` — mobile navigation opened or closed;
- `outbound_click` — external destination selected;
- `contact_interest` — visitor selected the Contacts section;
- `contact_action` — visitor activated a contact link inside the Contacts section.

## Architecture boundary

The current GitHub Pages architecture is static. Events are stored locally in the visitor's browser through `sessionStorage`; they are not a centralized visitor database and cannot be used to identify a person.

For centralized aggregate analytics, a separate collector/analytics backend is required. That backend must be selected and configured explicitly; credentials and external tracking identifiers are not embedded in the public repository.

## Engagement funnel

`page_view → topic/navigation interest → contact_interest → contact_action → real-world inquiry`

Anonymous engagement statistics and identifiable contact records must remain separate systems. If a future contact form collects personal data, consent, legal notice, retention, and access controls should be designed independently of anonymous audience analytics.

## Next stage

The next architectural layer is an Intelligence Dashboard that can consume privacy-respecting aggregate data and expose:

- most engaged sections and publications;
- contact-interest rate;
- outbound interaction rate;
- recurring engagement patterns;
- anomalies and trend changes.

No centralized analytics provider is assumed until one is deliberately selected.
