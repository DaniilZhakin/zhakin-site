# SEO 3.6 — Self-Healing / Recovery Orchestrator

State: **RECOVERED**
Action: **NONE**
Fingerprint: `f8587a3407760f17`

**Decision:** No active correlated incidents and production verification is healthy.

## Safety policy

- Automatic repair is limited to deterministic monitoring/recovery artifacts and verification reruns.
- Production HTML, publication text, canonical targets, robots.txt and sitemap.xml are never modified by the orchestrator.
- Persistent production failure escalates to a corrective GitHub Issue; content changes require review.
