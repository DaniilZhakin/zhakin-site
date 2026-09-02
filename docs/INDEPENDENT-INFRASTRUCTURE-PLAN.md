# Independent Infrastructure Plan — жакин.рф

## 1. Objective

Build an infrastructure contour in which the public site does not depend on a single hosting, DNS, or operational provider.

The migration principle is **parallel first, cutover second**: the existing production site remains untouched until an independent replacement is healthy and independently verified.

## 2. Current baseline

- Canonical domain: `жакин.рф` / `xn--80alhhq.xn--p1ai`
- Source of truth: Git repository `DaniilZhakin/zhakin-site`
- Current public delivery: static site / GitHub Pages
- Existing DNS/hosting dependency: must be verified before any cutover
- Intelligence 3.0: isolated optional contour; it must never become a prerequisite for public rendering

No production DNS change is authorized by this document.

## 3. Target topology

```text
                    ┌──────────────────────┐
                    │  Independent DNS     │
                    │  control / registrar │
                    └──────────┬───────────┘
                               │
                 ┌─────────────┴─────────────┐
                 │                           │
        ┌────────▼────────┐         ┌────────▼────────┐
        │ Primary origin  │         │ Recovery origin │
        │ static hosting  │         │ independent    │
        └────────┬────────┘         └────────┬────────┘
                 │                           │
                 └─────────────┬─────────────┘
                               │
                        жакин.рф / HTTPS
                               │
                    ┌──────────▼──────────┐
                    │ Public static site │
                    └─────────────────────┘

 Git repository ──► reproducible deployment
 Backup repository ─► source recovery
 Assets backup ─────► media recovery
 Intelligence 3.0 ─► isolated optional service
```

The exact providers for DNS, primary origin, recovery origin, and backup storage remain a separate operational decision. Provider neutrality is intentional.

## 4. Mandatory gates before DNS cutover

### Gate A — DNS ownership and control

- [ ] Administrative control of the domain is independently verified.
- [ ] DNS management is accessible independently of the current web host.
- [ ] Current DNS records are exported/documented.
- [ ] TTL strategy is documented.
- [ ] Rollback records are prepared before cutover.

### Gate B — Independent origin

- [ ] Full repository can be deployed without the current hosting provider.
- [ ] All static pages render correctly.
- [ ] `assets/` and images load.
- [ ] `robots.txt` is available.
- [ ] `sitemap.xml` is available.
- [ ] Canonical URLs remain on the official domain.
- [ ] HTTPS certificate is valid.
- [ ] No production dependency on Intelligence 3.0 exists.

### Gate C — Backup and recovery

- [ ] Independent repository backup exists.
- [ ] Assets backup exists.
- [ ] Recovery procedure has been executed on a disposable environment.
- [ ] A known-good commit is recorded.
- [ ] Recovery does not require secrets committed to Git.

### Gate D — Verification

- [ ] HTTP status checks pass.
- [ ] Core navigation passes.
- [ ] Publication pages pass.
- [ ] Reception page passes.
- [ ] SEO files pass.
- [ ] No mass 4xx/5xx responses.
- [ ] Search-engine-facing metadata is intact.
- [ ] Failure of the current origin does not prevent recovery from the independent origin.

### Gate E — Cutover approval

**DNS cutover is permitted only when Gates A–D are evidenced.**

The change must be reversible, with the previous production configuration preserved until the new origin has completed a stability observation period.

## 5. Cutover procedure

1. Freeze the known-good site commit.
2. Export/document current DNS records.
3. Deploy the same commit to the independent origin.
4. Validate the independent origin using its temporary/non-production hostname.
5. Validate HTTPS, headers, assets, navigation, SEO files, canonical and structured data.
6. Lower TTL only if operationally necessary and sufficiently in advance of the planned cutover.
7. Change only the required DNS records.
8. Verify DNS propagation and HTTPS from independent networks.
9. Run public-site smoke tests.
10. Keep the previous origin available for rollback.
11. If validation fails, revert DNS to the previous known-good records.

## 6. Rollback criteria

Immediate rollback is required if any of the following occurs after cutover:

- homepage unavailable;
- core navigation broken;
- widespread 4xx/5xx errors;
- assets unavailable;
- HTTPS/certificate failure;
- canonical domain corruption;
- `robots.txt` or `sitemap.xml` failure;
- material SEO metadata loss;
- unexpected dependency on Intelligence 3.0;
- unexplained integrity or security anomaly.

## 7. Intelligence 3.0 isolation

The collector, Durable Object, and D1 are not part of the public-site availability path.

Browser transport remains disabled until the Security & Operations and production gates are explicitly satisfied. A collector outage must degrade only intelligence collection, never page rendering, navigation, or access to publications.

## 8. Operational rule

**No blind DNS switch. No provider lock-in by architecture. No production dependency on an unverified service.**

The desired end state is not merely a second host. It is a recoverable operating model where domain control, source code, static delivery, backups, and intelligence services can be replaced independently.
