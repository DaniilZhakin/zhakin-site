# ZHAKIN TEAM — Strategic Centers Architecture

**Status:** Architecture proposal / documentation-only  
**Date:** 2026-11-18  
**Scope:** ZHAKIN TEAM and the official Жакин.рф platform  
**Release boundary:** This document does not authorize production deployment, public claims of accreditation, regulated valuation services, collection of client data, or financial transactions.

## 1. Executive decision

Establish two distinct but interoperable expert units:

1. **ZHAKIN Analytical Center** — research, monitoring, data analysis, scenario modelling, and publication of evidence-backed analytical work.
2. **ZHAKIN Asset Valuation Center** — preliminary asset analysis, valuation-method selection, financial modelling, valuation review, and coordination of qualified independent valuation where a formal report is required.

The centers share a controlled research and evidence layer but retain separate mandates, review gates, deliverables, and accountability. The Analytical Center must not certify valuations; the Asset Valuation Center must not present preliminary internal estimates as formal independent valuation reports.

## 2. Operating principles

- Evidence first: every material claim and input has a source, date, owner, and traceable calculation.
- Separation of duties: author, reviewer, approver, and publisher are distinct roles where risk warrants it.
- Human accountability: AI and automated agents may collect, classify, calculate, and draft; they cannot approve, sign, certify, or publish restricted outputs autonomously.
- Method transparency: disclose assumptions, data gaps, sensitivity, uncertainty, and limitations.
- Conflict management: disclose and record client, ownership, transaction, and compensation conflicts; decline or escalate engagements where independence cannot be protected.
- Privacy and security: collect only necessary data; use least-privilege access, retention limits, and audit trails.
- No false authority: do not claim accreditation, professional qualification, independence, or regulatory status unless verified and legally approved.

## 3. ZHAKIN Analytical Center

### Mandate
Produce decision-useful research on economic, financial, industrial, trade, technology, infrastructure, food-security, and geopolitical developments.

### Workstreams
1. Macroeconomics, finance, and investment environment.
2. International trade, export markets, logistics, and food security.
3. Industry, industrial assets, infrastructure, and supply chains.
4. AI, digital technologies, robotics, and productivity.
5. Geopolitical, regulatory, operational, and country risk.
6. Social impact, philanthropy, and digital-platform development.

### Standard products
- Daily monitoring brief (signal, source, relevance, confidence).
- Weekly sector and country dashboard.
- Monthly strategic outlook with base/upside/downside scenarios.
- Thematic research report.
- Country, sector, and counterparty risk note.
- Data tables and methodology annexes.

### Research workflow
1. Intake and define the decision question.
2. Register scope, period, geography, audience, and materiality.
3. Gather primary and reputable secondary sources.
4. Record source metadata and resolve conflicts.
5. Analyse data; label facts, estimates, assumptions, and opinions separately.
6. Run peer review and source/citation checks.
7. Approve, publish, version, and monitor corrections.

### Minimum quality record
Each deliverable records: owner, reviewer, publication date, data cut-off, scope, source register, methodology, assumptions, confidence/limitations, conflicts disclosure, and version history.

## 4. ZHAKIN Asset Valuation Center

### Mandate
Provide structured asset intelligence and preliminary valuation analysis; coordinate formal independent valuation through appropriately qualified professionals when the intended use or applicable law requires it.

### Asset coverage
- Operating businesses, equity interests, and business units.
- Commercial and residential real estate.
- Industrial plants, machinery, and equipment.
- Infrastructure and energy/transport assets.
- Financial instruments and investment interests.
- Intellectual property and intangible assets.
- Digital assets, subject to separate legal, custody, liquidity, and market-risk review.

### Engagement types
A. **Asset screening:** identity, ownership evidence, asset perimeter, key risks, and available data.  
B. **Indicative analysis:** preliminary range or scenario model, explicitly non-certified and dependent on stated assumptions.  
C. **Valuation review:** critical review of an existing model/report; does not replace the responsible valuer.  
D. **Formal valuation coordination:** engagement of an appropriately qualified and legally eligible independent appraiser/valuation firm; scope and signatory status verified before work begins.

### Methodology selection
Use the approach appropriate to the asset, purpose, jurisdiction, and evidence:
- Income approach (including DCF where suitable).
- Market approach (comparable companies, transactions, or asset comparables).
- Cost approach (replacement/reproduction cost, depreciation, obsolescence).
- Asset-based methods / adjusted net asset value where relevant.

Do not force a single method across unlike asset classes. Reconcile methods and explain why any method was excluded.

### Mandatory report structure
1. Engagement purpose and intended users.
2. Asset identification and valuation perimeter.
3. Valuation date and applicable basis/standard.
4. Ownership/title and legal constraints reviewed (or explicitly not reviewed).
5. Source register and data limitations.
6. Methodology and rationale.
7. Assumptions, adjustments, and calculations.
8. Sensitivity/scenario analysis where material.
9. Marketability, liquidity, concentration, and execution risks.
10. Conflicts, independence statement, limitations, reviewer, and approval status.

### Independence and legal boundary
An internal estimate is an analytical product, not a statutory or certified valuation. Before offering formal services, verify the applicable jurisdiction's qualification, membership, insurance, independence, reporting, and professional-standard requirements. The platform must never imply that an internal analyst or AI agent is a licensed appraiser. Formal reports must be signed only by the responsible qualified professional or firm.

## 5. Shared platform architecture

### Shared capabilities
- Research and engagement intake.
- Source/document registry with provenance and access controls.
- Data dictionary and versioned assumptions.
- Calculation/model workspace with reproducible inputs.
- Review and approval workflow.
- Deliverable repository and publication controls.
- Append-only audit events for material actions.
- Corrections, withdrawal, and version history.

### Separation of domains
The two centers may share source-management infrastructure, but each must have separate workspaces, permissions, review policies, and output classifications. Asset-valuation client files must not become public research sources by default. Confidential engagement information must never be copied into public analytical products without a documented lawful basis and review.

### ZHAK / robot integration
AI agents may perform bounded tasks such as source discovery, extraction, classification, calculation assistance, anomaly detection, draft preparation, and checklist validation. Each agent receives one task and minimum required capabilities. Agents cannot grant themselves permissions, approve their own work, sign reports, alter audit history, or publish restricted deliverables. Human review remains mandatory at defined gates.

### Suggested roles
- Center Director — mandate, resources, and accountability.
- Research / Valuation Lead — technical methodology and work allocation.
- Analyst — research and model preparation.
- Independent Reviewer — challenge of sources, assumptions, and calculations.
- Compliance / Legal Reviewer — jurisdiction, conflicts, confidentiality, and claims.
- Publisher / Records Custodian — controlled release and archive.
- AI/Robot Service Principal — narrow task-scoped automation only; no approval authority.

Role grants must be explicit, scoped, time-bound where appropriate, revocable, and independently audited. Do not reuse Wallet identities, sessions, participant roles, or financial permissions.

## 6. Website information architecture

Proposed public navigation entry: **Экспертные центры**.

- /centers/ — overview, mandates, boundaries, and links.
- /centers/analytical/ — Analytical Center, research themes, public reports, methodology.
- /centers/asset-valuation/ — Asset Valuation Center, service taxonomy, process, limitations, and engagement enquiry route only after approved intake controls exist.

Public pages should publish only approved, non-confidential material. Until qualifications and legal status are verified, use wording such as “аналитический центр”, “предварительный анализ стоимости”, and “координация независимой оценки”; avoid “официальная оценка”, “сертифицированный оценщик”, “аккредитованный центр”, or equivalent claims.

## 7. Initial delivery plan and gates

### Phase 0 — governance and design
- Confirm organizational owner and legal entity for each center.
- Approve mandates, service boundaries, conflict policy, confidentiality rules, and publication policy.
- Verify jurisdiction-specific requirements before offering valuation services.
- Define document classifications and role matrix.

### Phase 1 — research MVP
- Publish center overview and analytical methodology.
- Establish source register, research templates, review checklist, and correction process.
- Produce one pilot weekly brief using traceable public sources.

### Phase 2 — asset-analysis MVP
- Launch internal-only asset intake checklist and model templates.
- Use synthetic/test data first; do not collect live client documents until access, retention, consent, and security controls are approved.
- Label all outputs “предварительный анализ / не является независимым отчётом об оценке” unless a qualified signatory has issued a formal report.

### Phase 3 — controlled platform integration
- Add separate center workspaces, role-scoped access, audit trail, and human approvals.
- Test authorization, data isolation, export controls, retention, and deletion workflows.
- Complete security and legal review before any live engagement intake.

### Phase 4 — public launch
- Publish only after governance, legal claims, qualification checks, content review, and operational controls are signed off.
- Keep public website content separate from confidential workspaces.

## 8. Initial KPIs

**Analytical Center**
- Share of material claims with traceable sources.
- On-time delivery rate.
- Peer-review completion rate.
- Correction rate and time to correction.
- Research reuse/citation and reader engagement (reported separately from quality).

**Asset Valuation Center**
- Intake completeness.
- Share of models with documented source and assumption registers.
- Independent review completion.
- Sensitivity and limitation disclosure rate.
- Conflict checks completed before engagement.
- Turnaround time by engagement type.

Do not use the number or headline value of assets “valued” as a quality KPI without context.

## 9. Acceptance criteria for implementation

- Two separate center pages and clearly differentiated mandates.
- No unsupported accreditation or qualification claims.
- No public exposure of confidential engagement material.
- Separate center permissions and audit trails.
- Human approval required for restricted outputs and publication.
- Every analytical/valuation deliverable carries source, date, method, assumptions, limitations, owner, and review status.
- Automated tests cover route integrity, mobile layout, access boundaries, and publication state.
- No production deployment until all required legal, security, and owner approvals are recorded.

## 10. Explicit non-goals for this stage

- No live client intake or document uploads.
- No automated certified valuation or investment recommendation.
- No custody, trading, transfer, or management of assets.
- No financial promises, guaranteed returns, or unsupported market claims.
- No production database, authentication, secrets, Worker, or deployment changes.
- No changes to Wallet, ZP, BFU, or the separate USERDIE / «УСЕРДИЕ» project.
