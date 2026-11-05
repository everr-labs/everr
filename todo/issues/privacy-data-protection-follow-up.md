# Privacy and data protection follow-up

Status: proposed follow-up work. Updated 2026-10-21.

Treat incoming telemetry as potentially containing personal data. Establish what
Everr collects, reduce unnecessary collection, and document the responsibilities
of Everr and its customers. Final public statements and contractual commitments
must match implemented behavior.

This is an internal work plan. The public privacy notice remains a draft at
[`packages/docs/content/legal/privacy.mdx`](../../packages/docs/content/legal/privacy.mdx).
The customer DPA is now drafted at
[`packages/docs/content/legal/dpa.mdx`](../../packages/docs/content/legal/dpa.mdx),
including provisional processing, security, and subprocessor schedules. None of
the legal drafts is ready to be presented for acceptance.

## Business-only decision (2026-11-02)

Everr is offered for business and professional use, including professional
learning and evaluation. The Hobby plan remains available. Signup confirms the
intended use and Terms. Pro purchases go directly to Polar. The unshipped
consumer checkout and withdrawal implementation has been removed. Review the
business Terms, Polar responsibilities, and customer transition before release.

## Confirmed facts and policies

These facts were confirmed by the operator during drafting. Operational
enforcement still needs verification where noted below.

| Area                                            | Confirmed position                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator                                        | Giordano Ricci. Business and formal notice address: Rua das Meloas 10C, 2805-235 Almada, Portugal. Full address as provided: R MELOAS LOJA, N 10C, COVA DA PIEDADE, 2805-235 ALMADA, SETUBAL, Portugal. Parish: ALMADA, COVA DA PIEDADE, PRAGAL E CACILHAS.                                                                                                                                       |
| Customer audience                               | Business and professional use only, including professional evaluation, learning, and small projects. The Hobby plan remains available. Changed by the operator on 2026-11-02.                                                                                                                                                                                                                     |
| Privacy contact                                 | `hello@everr.dev` receives privacy requests.                                                                                                                                                                                                                                                                                                                                                      |
| Application hosting                             | Scaleway, Paris, France.                                                                                                                                                                                                                                                                                                                                                                          |
| Application database backups                    | Scaleway Postgres backups, stored in Paris, expire after seven days.                                                                                                                                                                                                                                                                                                                              |
| Telemetry storage                               | ClickHouse Cloud on AWS in the EU.                                                                                                                                                                                                                                                                                                                                                                |
| Telemetry backups                               | ClickHouse backups expire after one day.                                                                                                                                                                                                                                                                                                                                                          |
| Telemetry retention                             | Code assigns Hobby 14 days and Pro 365 days to traces, logs, and metrics at ingestion. Date-based expiry is asynchronous, and deployed enforcement remains to be verified.                                                                                                                                                                                                                        |
| Operational logs                                | Retained for one year.                                                                                                                                                                                                                                                                                                                                                                            |
| Account deletion                                | Immediate deletion can be requested where lawful. Verify the execution path and records subject to separate retention.                                                                                                                                                                                                                                                                            |
| Transactional email                             | Scaleway Transactional Email, documented by Scaleway as operating in Paris.                                                                                                                                                                                                                                                                                                                       |
| Team correspondence                             | Google Workspace Business Starter. This edition does not include data-region controls.                                                                                                                                                                                                                                                                                                            |
| Google agreement                                | The operator confirmed accepting Google's Cloud Data Processing Addendum. Record the accepted version and contracting entity.                                                                                                                                                                                                                                                                     |
| Website analytics                               | PostHog Cloud EU, hosted in Frankfurt. Live capture settings and retention still need confirmation.                                                                                                                                                                                                                                                                                               |
| Billing                                         | Polar. Its published processing arrangements include US processing.                                                                                                                                                                                                                                                                                                                               |
| Subscription cancellation                       | Takes effect immediately. No new overage usage is accepted after cancellation. Access continues until the end of the current billing period, and the subscription does not renew. Verify enforcement in Everr and Polar.                                                                                                                                                                          |
| Outstanding overage                             | Overage incurred before cancellation remains payable.                                                                                                                                                                                                                                                                                                                                             |
| Refunds                                         | Payments are non-refundable, including unused time, unless a refund is required by law. Access continues through the paid billing period.                                                                                                                                                                                                                                                         |
| Subscription price increases                    | At least 30 days' advance notice by email. Effective at the first renewal on or after the notice period ends, with no change to an already-paid billing period. Customers can cancel before the higher price applies; any longer legally required notice remains applicable.                                                                                                                      |
| Support and availability                        | Best-effort support by email at `hello@everr.dev` or through the Everr Discord channel. No guaranteed support response time or uptime SLA for the standard service.                                                                                                                                                                                                                               |
| Planned shutdown                                | At least 60 calendar days' advance notice by email, or longer where legally required. Stop renewals and continue providing paid service through the end of existing paid billing periods. Preserve legally required refunds and other remedies if service ends early.                                                                                                                             |
| Material Terms changes and core-feature removal | At least 30 calendar days' advance notice by email, preserving any longer notice period and other mandatory rights. A narrow exception for legally required or urgent security changes is drafted for review.                                                                                                                                                                                     |
| Liability drafting direction                    | Three-month aggregate fee cap for ordinary paid business-customer claims, shared across Terms and DPA. Contractual confidentiality, security, and data-processing claims share that cap unless expressly agreed otherwise, subject to exceptions and mandatory law. Free-business-service exclusion with EUR 100 fallback and a limited business-customer indemnity are drafted for legal review. |
| Restricted-data drafting direction              | Ordinary necessary personal data may be processed under the applicable terms. Government identifiers, payment/bank details, sensitive personal data, criminal-record data, and unsupported specially regulated data require prior express written agreement and necessary safeguards. Credentials must stay out of telemetry.                                                                     |

Public hosting wording identifies the European Union rather than committing to a
particular city or cloud region. The confirmed Paris and Frankfurt configuration
above remains an internal operational record. Maintain exact locations and
supplier arrangements internally, including support access and international
transfers. EU hosting does not imply that email, billing, support, or all other
processing stays in the EU. Retention periods are unchanged.

Backup expiry is separate from retention of live telemetry. Deleting an account
also needs to be distinguished from deleting an organization, customer telemetry,
billing records, operational logs, and copies in backups.

### Portugal-specific legal follow-up (2026-11-02)

- [x] Add the operator's NIF to the draft Terms, as required by
      [Decreto-Lei 7/2004, Art. 10](https://diariodarepublica.pt/dr/detalhe/decreto-lei/7-2004-240775).
- [ ] Make the provider details easily accessible when published and record any
      applicable public-register details.
- [ ] Verify whether the electronic complaints book applies to the business and,
      if so, register and prominently link it; assess the physical-book rules
      separately if the office receives the public. See
      [Decreto-Lei 156/2005](https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-lei/2005-34431675).
- [ ] Review the business Terms and checkout under Portuguese law. Confirm tax
      and invoicing responsibilities with a Portuguese accountant in light of
      Polar's merchant-of-record arrangement.

### Repository review (2026-11-02)

These findings describe the current workspace, not verified production settings:

- The docs site's PostHog client sets `cookieless_mode: "always"`; its Everr
  browser SDK uses memory storage. The app's SDK uses memory until analytics
  storage is accepted. Its `everr.consent` cookie lasts one year, and the
  account menu reopens the preference dialog. Denying or withdrawing the choice
  switches identifiers to memory but does not stop event collection or delete
  events already sent. See `packages/docs/src/lib/posthog.ts`,
  `packages/docs/src/lib/telemetry.ts`, and `packages/app/src/telemetry/`.
- The privacy notice now describes this distinction. The applicable lawful
  basis, consent analysis, actual deployment, other storage, PostHog project
  settings, and retention still require verification. Portugal's
  [CNPD guidance on cookies](https://www.cnpd.pt/media/x2zdus50/nota-informativa-cnpd_cookies_20210625.pdf)
  discusses consent for analytics cookies; do not infer the outcome for all
  memory-based processing from that guidance alone.
- `packages/cloud/src/retention.ts` sets 14 days for Hobby and 365 for Pro for
  traces, logs, and metrics. ClickHouse views assign date-based TTLs and expire
  data asynchronously; code inspection does not establish live configuration
  or a precise physical deletion deadline. The retention reference no longer
  promises that data can never be deleted early.
- Organization deletion cleans up application records in Postgres and queues
  ClickHouse access deprovisioning. The inspected path does not implement early
  deletion of tenant telemetry. Return, downstream copies, and reapplication of
  deletion after backup restoration remain unverified. GDPR Art. 28(3)(g) and
  [EDPB processor guidance](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en)
  should inform the completed return/deletion procedure.
- The current workspace enables account deletion but restricts deletion for
  owners of Pro organizations and requires ownership handling. It does not prove
  deletion of every related record or backup.
- A local Everr query contained no recent application logs, and the CLI had no
  saved cloud session. Provider consoles, signed agreements, exact locations,
  retention settings, backups, and live security controls were not available
  to this review. Keep the DPA and privacy notice in draft.

## 1. Audit collection and introduce safer defaults

Map data from source instrumentation through ingestion, storage, queries,
notifications, exports, support, and any connected assistants. Review both
customer telemetry and Everr's own website and service monitoring. Begin with
code and configuration, then validate with synthetic data through the real
pipeline. Avoid exporting customer payloads merely to perform this assessment.

Initial source observations, not a completed runtime audit:

- [`client.ts`](../../packages/otel-web/src/client.ts) initializes page context
  using `location.href` and `document.referrer`, and records the landing URL.
- [`envelope.ts`](../../packages/otel-web/src/pipeline/envelope.ts) attaches page
  and referrer URLs to events. URLs can contain identifiers or secrets.
- [`element.ts`](../../packages/otel-web/src/instrumentations/element.ts) avoids
  reading form values and element text, excludes password and hidden inputs,
  and supports `.everr-no-capture`. It also captures link destinations and
  selector attributes, which still need assessment for sensitive content.
- [`session.ts`](../../packages/otel-web/src/state/session.ts) supports explicit
  user identification and customer-supplied traits.
- [`request.ts`](../../packages/otel-web/src/instrumentations/network/request.ts)
  excludes query strings from recorded network request URLs. URL paths can
  still identify people, and this behavior does not sanitize other URL fields.

Follow-up:

- [ ] Inventory automatically captured fields, optional features, customer
      attributes, and free-text log and error content.
- [ ] Define collection defaults that avoid credentials, unnecessary identifiers,
      request and response bodies, and form contents.
- [ ] Sanitize page, landing, referrer, and link URLs consistently. Assess query
      parameters, fragments, path identifiers, and dynamic selector attributes.
- [ ] Provide documented customer controls to exclude attributes, redact values,
      disable capture, and filter data before export.
- [ ] Consider an additional ingestion filter where appropriate. Record its
      limits rather than promise complete detection of personal data.
- [ ] Verify with synthetic identifiers and secrets that unwanted fields do not
      reach storage, operational logs, exports, or notification destinations.
- [ ] Use Everr to verify ingestion and inspect the resulting synthetic telemetry
      after instrumentation changes. Preserve standard OpenTelemetry semantics.
      For browser SDK changes, measure bundle size and update the emitted-event
      catalog when events or attributes change.

Data minimization and protection by design are grounded in GDPR Arts. 5(1)(c)
and 25. OpenTelemetry recommends minimizing sensitive collection and provides
filtering and redaction approaches. See [OpenTelemetry guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/)
and [EDPB guidance on privacy by design](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en).

## 2. Establish customer contracts and supported uses

- [x] Prepare an initial Terms of Service draft covering the service scope, account responsibilities,
      acceptable use, subscriptions and cancellation, suspension, data ownership,
      liability, notices, and governing law for the business-only service.
- [x] Draft Everr's customer DPA, including processing instructions, data
      categories, confidentiality, security, subprocessors, incident assistance,
      privacy-request assistance, deletion or return, and audit provisions.
- [x] Draft customer responsibilities for lawful collection, notices, consent
      where required, instrumentation configuration, and data minimization.
- [x] Draft the supported personal-data and restricted-data policy, including
      prior written agreement and safeguards for exceptions, credential exclusion,
      source filtering/redaction, and reporting accidental submissions.
- [ ] Verify the restricted-data review and incident-handling process, supported
      collection controls, and safeguards before accepting any exception. Written
      approval alone does not establish readiness for regulated data.
- [ ] Add an onboarding declaration about intended data types and uses, with
      clear instructions for keeping secrets and unnecessary personal data out.
- [ ] Have counsel review the DPA, service terms, acceptable use restrictions,
      and liability provisions for the operator's jurisdiction and business form.
- [ ] Present Terms and the privacy notice in onboarding. Define how the DPA
      becomes part of the relevant customer agreement.
- [ ] Record the appropriate person's acceptance, including the terms version,
      timestamp, account, and organization where relevant. Cover email signup,
      Google signup, and any later organization acceptance flow.
- [ ] Keep contract acceptance separate from optional analytics consent. The
      privacy notice informs users about processing; acceptance of service terms
      is not consent for unrelated optional processing.

Cloud signup now has a minimal initial acceptance implementation. The
[`sign-up component`](../../packages/app/src/routes/_welcome/_guest/auth/sign-up.tsx)
presents Terms and privacy links through Cloud composition. Cloud signup always
requires an initially unchecked Terms agreement for both email and Google signup.
There is no runtime draft gate or bypass. The website's draft labels are an
editorial review status and do not control signup enforcement. Self-hosted signup
has no Cloud terms requirement. Finalize the documents before deploying this flow.

The exact UTF-8 bytes of
`packages/docs/content/legal/terms.mdx`, including its frontmatter, are hashed with
SHA-256 at build time. Both the docs and Cloud builds hash that same source file with SHA-256.
Both signup methods use the same `{ termsHash }` payload. Email signup sends it
in the request body; Google signup carries it through
Better Auth's protected OAuth state. New-account creation rejects a missing or
stale hash. Existing sign-ins do not create or replace acceptance evidence.

The Cloud-owned `user_terms` table stores one `terms_hash` per user. It is written
in the same transaction as the new user. The user's existing `createdAt` supplies
the initial acceptance timestamp. There is no acceptance history table or
separate version registry. Keep every released document in Git and retain its
exact source bytes, so the recorded hash can be independently reproduced.
Privacy notice acknowledgement and optional analytics consent are separate from
contract acceptance.

Before enabling this in production:

- [ ] Complete the legal operator placeholders, document review, DPA schedules,
      and other release blockers, then remove the website's draft labels before
      deployment.
- [ ] Reconcile the existing local migration with the final signup schema before
      release. The unshipped consumer implementation has been removed; no new
      migration was generated during schema iteration.
- [ ] Apply the migration to each deployed Cloud database before releasing these
      changes. Every new account writes acceptance, so the tables must exist
      before signup is enabled. Local development has been migrated.
- [ ] Deploy the docs and Cloud from the same finalized Terms source. The signup
      link includes its hash; `/terms?hash=...` refuses to display a different
      revision. If the deployments differ, release the matching docs before
      making signup available. Git is the source archive; public access to old
      revisions is not implemented.
- [ ] Decide how to obtain acceptance from existing accounts created before this
      flow, and from an authorized person for an organization when needed.
      Do not backfill an acceptance hash from account creation alone.
- [ ] Define any future material-change notice and renewed acceptance flow.
      Initial `createdAt` is not a timestamp for later acceptance.
- [x] Implement signup Terms acceptance. Sandbox verification remains.

The application already has a telemetry consent interface; verify its actual
behavior separately rather than assuming it needs to be built from scratch.

Polar's checkout agreement expressly refers to a separate Supplier Agreement
governing use of the product. Draft Everr's own terms and make them available
through the purchase flow as well as account onboarding. See
[Polar's buyer terms](https://polar.sh/legal/checkout-buyer-terms).

For customer telemetry processed on instructions, Everr will generally act as a
processor. Roles depend on actual activities. Contract language and a prohibition
on sending personal data do not remove Everr's own applicable obligations.
GDPR Arts. 4 and 28. See [EDPB controller and processor guidance](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en).

## 3. Verify security, retention, and deletion

- [ ] Review tenant isolation, role-based access, privileged staff access, access
      records, and protection of stored and transmitted data.
- [ ] Verify enforcement of telemetry, operational-log, and backup expiry periods.
- [x] Reconcile the documented plan windows with the code: Hobby 14 days and Pro
      365 days for traces, logs, and metrics. Verify deployed enforcement separately.
- [x] Remove the retention reference's absolute promise never to delete before
      expiry. Early telemetry deletion remains deferred, not verified or waived.
- [ ] Define and verify account and organization deletion separately, including
      memberships, invitations, telemetry, downstream systems, and retained records.
- [ ] Confirm that data deleted from active systems can remain in expiring backups,
      and implement a restoration procedure that reapplies relevant deletions.
- [ ] Assess offering shorter telemetry retention where customer purposes require
      it; one year should not be treated as necessary for every use.
- [ ] Set retention for support correspondence, website analytics, security events
      outside operational logs, and billing/legal records.
- [ ] Establish privacy-request and incident-response procedures, including
      identity verification, escalation, customer communication, and evidence.

Relevant GDPR provisions include storage limitation (Art. 5(1)(e)), privacy
requests (Arts. 12 to 22), processor assistance (Art. 28), and security and breach
handling (Arts. 32 to 34). See [EDPB guidance on individual rights](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en).

## 4. Complete supplier and website analytics review

- [ ] Verify Brevo's contracting entity, processing locations, applicable DPA
      and transfer safeguards, retention, deletion and reconciliation procedures,
      and any account automations. Production telemetry from November 2, 2026
      shows CRM synchronization enabled. The integration syncs account,
      organization, membership and subscription information; it does not itself
      enroll contacts in marketing lists or campaigns. The privacy notice includes
      this flow.

- [ ] Confirm the processing terms in force for Scaleway, ClickHouse, PostHog,
      and Polar, including whether terms are incorporated automatically.
- [ ] Keep the accepted Google addendum version and contracting entity internally.
- [ ] Map applicable transfer destinations and safeguards to actual data flows.
      EU storage does not establish that every support or operational activity
      stays in the EU. Review relevant transfers under GDPR Arts. 44 to 49.
- [ ] Confirm the provider list covers support, infrastructure, integrations,
      notifications, and error monitoring actually used.
- [ ] Include Discord support in the provider and data-flow review, and update
      the privacy notice as appropriate.
- [ ] Check PostHog server hash mode, identification, capture options, retention,
      and any features enabled through project settings.
- [ ] Inventory cookies and other browser storage, including purpose and duration.
- [ ] Establish the lawful basis for each analytics purpose and whether consent
      or a specific exemption applies. Implement required preference controls.

Cookieless configuration alone does not settle the consent assessment. See
[CNIL analytics guidance](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications).

Supplier references:

- [Scaleway contracts](https://www.scaleway.com/en/contracts/)
- [ClickHouse DPA](https://clickhouse.com/legal/agreements/data-processing-addendum)
  and [subprocessors](https://clickhouse.com/legal/agreements/clickhouse-subprocessors)
- [PostHog DPA](https://posthog.com/dpa) and [subprocessors](https://posthog.com/subprocessors)
- [Polar processing terms](https://polar.sh/legal/data-processing-addendum),
  [privacy policy](https://polar.sh/legal/privacy-policy), and
  [subprocessors](https://polar.sh/legal/sub-processors)
- [Google's published CDPA](https://cloud.google.com/terms/data-processing-addendum/)
  and [Workspace data-region coverage](https://knowledge.workspace.google.com/admin/compliance/data-covered-by-data-regions)

## 5. Resolve the DPO and representative assessment

Do not conclude that a DPO is unnecessary solely because Everr has one operator
or few customers. Under GDPR Art. 37, assess whether core activities involve
large-scale, regular and systematic monitoring of people, or large-scale
processing of special-category or criminal-offence data. Consider the people
represented in customer telemetry as well as Everr's account holders.

- [ ] Establish the operator's country and actual establishment.
- [ ] Identify whether processing tracks identifiable people, based on the
      collection audit and customer use cases. A precise count is not the first
      prerequisite; document a reasonable assessment of scope and scale.
- [ ] Record the DPO decision, reasoning, and circumstances that trigger review.
- [ ] Assess EU and UK representation separately, based on establishment,
      territorial scope, and applicable exceptions (GDPR Arts. 3 and 27).
- [ ] Arrange a focused privacy-lawyer review of these conclusions. Consider
      external DPO services if appointment is required.

Public accessibility worldwide alone does not settle territorial scope.
`hello@everr.dev` remains the privacy contact; do not describe the operator as a
DPO without an appointment that meets the role's requirements.

References: [EDPB DPO guidance](https://www.edpb.europa.eu/sme/be-compliant/data-protection-officer_en),
[EDPB territorial-scope guidance](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_3_2018_territorial_scope_after_public_consultation_en_1.pdf),
and [ICO representative guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/receiving-personal-information-from-the-eea/).

## 6. Keep processing records and screen for impact assessments

- [ ] Maintain a written record of processing activities for relevant activities,
      with purpose, data categories, recipients, retention, locations, transfers,
      security measures, and controller/processor roles (GDPR Art. 30).
- [ ] Include Everr's own account, billing, support, analytics, and operational
      processing, alongside the relevant customer-telemetry processing records.
- [ ] Record lawful bases for Everr's own processing and assess legitimate
      interests where relied upon. Do not substitute a customer's legal basis
      for a separate purpose decided by Everr.
- [ ] Complete and retain a DPIA screening. Where processing is likely to create
      high risks to individuals, determine who must conduct a full DPIA and how
      Everr must assist customers (GDPR Arts. 28(3)(f) and 35).
- [ ] Revisit records and assessments when new telemetry, integrations, uses,
      providers, or material scale changes are introduced.

See [EDPB guidance on processing records and impact assessments](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en).

## 7. Retain security and operational evidence

Use the SOC 2 Trust Services Criteria as a practical framework for organizing
controls and evidence. This does not declare SOC 2 compliance or completion of an
examination. Formal reporting requires an independent examination.

- [ ] Keep privileged-access approvals, removals, and periodic access reviews
      with the person, date, scope, and result recorded (CC6).
- [ ] Keep change approvals and deployment records appropriate to the service
      and the risks involved (CC8).
- [ ] Record incidents, response actions, customer communications, and exercises
      that demonstrate the incident procedure works (CC7).
- [ ] Keep supplier assessments, applicable contracts, review dates, and
      follow-up actions (CC9.2).
- [ ] Exercise backup restoration and retain results, including recovery timing
      and the handling of previously deleted data (CC7; A1 if scoped).
- [ ] Maintain a risk register with the issue, owner, treatment, remaining risk,
      review date, and evidence (CC3).
- [ ] Decide on formal SOC 2 scope, report type, and audit timing separately if
      customer requirements justify it. Publish only verified assurance claims.

Reference: [AICPA's SOC suite of services](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services).

## Public documentation and completion

Suggested order for the website and onboarding work:

| Priority | Deliverable                   | Contents                                                                                                            |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1        | Terms of Service              | Scope, responsibilities, acceptable use, billing/cancellation, suspension, ownership, liability, and governing law. |
| 1        | Customer DPA                  | Instructions, processing details, security, subprocessors, incidents, individual rights, and deletion/return.       |
| 1        | Onboarding acceptance         | Available documents, appropriate acceptance, recorded version and timestamp, and email/Google signup coverage.      |
| 2        | Subprocessor page             | Providers, purposes, locations, update notices, and consistency with the customer DPA.                              |
| 2        | Security overview             | Verified controls, access, encryption, backups, incident contact, vulnerability reporting, and assurance status.    |
| 2        | Telemetry data-handling guide | Defaults, filtering/redaction, restricted data, retention/deletion, and customer responsibilities.                  |

- [ ] Finish the privacy notice using confirmed facts and verified behavior.
      Confirm any marketing, model-training, or significant automated-decision
      uses before making statements about them.
- [ ] Publish the customer DPA, a maintained subprocessor list, and service terms.
- [ ] Add a security overview and a customer guide to controlling telemetry data.
- [ ] Remove drafting placeholders and the draft flag only when the notice is final.

## Terms drafting decisions

The initial Terms draft is at
[`packages/docs/content/legal/terms.mdx`](../../packages/docs/content/legal/terms.mdx).
Prepare it for review alongside the privacy notice and customer DPA. Keep it
marked as a draft and out of search indexing while material decisions are open.

- [ ] Set the effective date and version. The operator's name, business address, and country have been provided.
- [x] Confirm and draft for business and professional use, including professional
      evaluation and small projects.
- [x] Record the confirmed cancellation policy: immediate cancellation, no new
      overage usage accepted afterward, and continued access until the end of
      the current billing period without renewal.
- [ ] Verify cancellation behavior in Everr and Polar, including immediate
      rejection of new overage usage and access through the billing-period end.
- [x] Record that overage incurred before cancellation remains payable.
- [x] Record the refund policy: no refunds for unused time or other payments,
      except where required by law; access continues through the paid period.
- [ ] Verify billing of overage incurred before cancellation and application of
      the refund policy in Everr and Polar, including required legal remedies.
- [x] Draft plan-change timing and proration based on terms disclosed before
      confirmation, with downgrades at the next renewal unless otherwise agreed.
- [ ] Verify disclosed usage rates, plan-change timing and proration against
      Polar and the implemented billing flows.
- [x] Record the subscription price-increase policy: at least 30 days' advance
      email notice, effective at the first renewal after that notice period,
      preserving already-paid prices and the opportunity to cancel.
- [ ] Verify price-change notifications and renewal pricing in Everr and Polar.
- [x] Record the planned-shutdown approach: stop renewals and provide paid service
      through existing paid billing periods, preserving legally required refunds
      and other remedies if service ends early.
- [ ] Verify the shutdown billing process can stop renewals while preserving
      service access through each customer's paid period.
- [ ] Review shutdown refunds and liability under the applicable law. Do not
      assume the last invoice caps refunds or total liability.
- [x] Record at least 60 calendar days' advance email notice for a planned
      shutdown, preserving any longer legally required notice period.
- [ ] Verify the planned-shutdown email notification process.
- [x] Record at least 30 calendar days' advance email notice for material Terms
      changes and core-feature removal, preserving longer legally required notice
      and other mandatory rights.
- [ ] Verify notification processes for material Terms changes and core-feature
      removal, including any required renewed acceptance.
- [x] Draft a narrow urgent legal/security exception and 30-day notice for
      individual termination for convenience, preserving existing paid periods
      and the separate 60-day planned-shutdown policy.
- [x] Record best-effort support by email or Discord, with no guaranteed response
      time or uptime SLA for the standard service. Any separate SLA must be agreed
      in writing.
- [x] Draft a three-month aggregate fee cap for paid business-customer claims,
      an exclusion of indirect/consequential business losses, and shared treatment
      of contractual confidentiality, security, and data-processing claims.
- [ ] Have counsel review the cap's calculation and aggregation, loss exclusions,
      and exceptions for fraud, intentional misconduct, gross negligence, negligent
      death/personal injury, and liability that cannot legally be limited.
- [x] Draft a separate free-business-service exclusion to the extent lawful,
      with a EUR 100 aggregate fallback where exclusion cannot be enforced and
      a monetary limit is permitted. Keep the same mandatory exceptions.
- [ ] Review the free-business-service exclusion/fallback.
      Verify final DPA alignment with the liability terms.
      The contract does not cap regulatory powers or individuals' statutory
      compensation rights (GDPR Arts. 82 and 83).
- [x] Draft a limited business-customer defense/indemnity for unauthorized data
      and unlawful use, excluding the part caused by Everr's breach. No general
      indemnity by Everr; no contractual regulatory-fine
      reimbursement. Review scope, defense control, and enforceability with counsel.
- [ ] Confirm customer-data export methods and any post-termination access window
      before promising them.
- [x] Draft DPA incorporation, document priority, and one shared contractual
      liability allocation. Add a working draft DPA link to the Terms and site.
- [ ] Finalize the DPA, completed schedules, version, and acceptance process before
      presenting the Terms/DPA for acceptance.
- [ ] Select governing law and forum after the operator's country is settled.

## Conventional drafting defaults and DPA readiness

The operator authorized conventional remaining Terms provisions aimed at limiting
Everr's contractual exposure. The draft choices below are proposed contract terms,
not claims that every operational process is implemented or legally reviewed.

| Topic                                         | Draft default                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account eligibility                           | At least 18 and legally able to contract. Verify signup handling.                                                                                                                 |
| Ordinary material breach                      | Ten calendar days after written notice to remedy; earlier action for an incurable breach, legal prohibition, or urgent security threat where lawful.                              |
| Confidentiality                               | Three years after termination; trade secrets while legally protected; retained personal data while held and as required by law/DPA.                                               |
| Free business services                        | Exclude liability where lawful, with EUR 100 aggregate fallback where exclusion fails and a cap is permitted. Mandatory exceptions remain.                                        |
| Customer indemnity                            | Limited to business-customer third-party claims caused by unauthorized Customer Data or unlawful use, with defense procedures and Everr-fault exclusion.                          |
| Additional data uses                          | Terms grant no right to sell Customer Data, use it for advertising, or train general-purpose models. Verify actual features and supplier settings against this commitment.        |
| Service disruption outside reasonable control | Limited relief with notice, mitigation and resumption duties; no waiver of accrued charges, mandatory refunds, or continuing data-protection duties.                              |
| DPA subprocessors                             | General written authorization for a completed list; 30-day email notice before additions/replacements, 14-day objection window, and resolution before disputed processing begins. |
| DPA audits and assistance                     | Information and audit rights, reasonable routine coordination, legally necessary additional review, and no fee dispute blocking mandatory assistance.                             |

Before acceptance of the DPA:

- [ ] Verify the return/export method and timing, early deletion capability,
      downstream copies, completion confirmation, and backup restoration process.
      Preserve the explicit draft implementation gap until resolved.
- [ ] Complete Schedule 2 against implemented access, encryption, isolation,
      recovery, maintenance, incident, and assistance controls. Do not claim
      certifications or reports Everr does not hold.
- [ ] Complete Schedule 3 with contracting entities, exact regions, supplier
      contracts, further processing locations, and applicable transfer safeguards.
- [ ] Classify Google Workspace, Discord, Scaleway Transactional Email, and other
      support/notification paths by whether they receive Customer Personal Data.
      Do not treat the two core infrastructure entries as a complete final list.
- [ ] Implement and verify designated customer contact records, subprocessor
      notices/objections, breach notifications, and assistance handling.
- [ ] Confirm the operator's establishment before selecting any needed transfer
      clauses/modules and completing their annexes; publication of a draft or a
      vendor's public terms is not evidence that a transfer mechanism is in force.
- [ ] Have counsel review the combined Terms/DPA allocation and mandatory rights.

Legal drafting references: [EDPB controller/processor contract guidance](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en)
and [Commission controller/processor clauses under Art. 28](https://commission.europa.eu/publications/standard-contractual-clauses-controllers-and-processors-eueea_en).
This DPA uses original wording and is not presented as the Commission's unmodified
standard clauses or as an international-transfer instrument.

Keep contract copies, assessment notes, and supporting evidence internally.
Public documentation should describe processing and available protections
accurately. Legal conclusions and contractual commitments need qualified review;
this work plan does not establish compliance.

## Drafting notes moved off the website (2026-10-21)

These notes were preserved from the longer legal drafts before simplifying the
public pages. They remain open alongside the task lists above; moving a note
does not complete the work or approve publication.

- [x] **Terms: Who provides Everr.** LEGAL NAME OF OPERATOR
- [x] **Terms: Who provides Everr.** BUSINESS ADDRESS, COUNTRY
- [ ] **Terms: Who provides Everr.** CONFIRM THE EFFECTIVE DATE, TERMS VERSION, AND ACCEPTANCE PROCESS BEFORE THESE TERMS TAKE EFFECT.
- [ ] **Terms: Retention, export, and deletion.** VERIFY THE RETURN/EXPORT PROCEDURE, EARLY TELEMETRY DELETION, AND BACKUP-RESTORATION HANDLING BEFORE THESE DOCUMENTS TAKE EFFECT. NORMAL TELEMETRY EXPIRY ALONE DOES NOT RESOLVE THE DPA DELETION REQUIREMENTS.
- [ ] **Terms: Governing law, disputes, and contact.** SELECT GOVERNING LAW AND COURTS OR OTHER DISPUTE PROCESS.
- [x] **Terms: Governing law, disputes, and contact.** NOTICE ADDRESS
- [x] **Privacy: Who is responsible.** LEGAL NAME OF OPERATOR
- [x] **Privacy: Who is responsible.** BUSINESS ADDRESS, COUNTRY
- [ ] **Privacy: Who is responsible.** CONFIRM WHETHER A DATA PROTECTION OFFICER OR EU/UK REPRESENTATIVE IS REQUIRED AND ADD THEIR CONTACT DETAILS IF APPLICABLE.
- [ ] **Privacy: Why we use personal data.** CONFIRM THE LEGAL BASIS FOR EACH ANALYTICS PURPOSE AND WHETHER PRIOR CONSENT IS REQUIRED FOR THE ACTUAL CONFIGURATION.
- [ ] **Privacy: Why we use personal data.** CONFIRM WHETHER ANY PERSONAL DATA IS USED FOR MARKETING, MODEL TRAINING, OR SOLELY AUTOMATED DECISIONS WITH LEGAL OR SIMILARLY SIGNIFICANT EFFECTS. ADD THE RELEVANT PURPOSES, BASES, AND SAFEGUARDS IF SO.
- [ ] **Privacy: Website analytics and browser storage.** CONFIRM THE LIVE ANALYTICS SETTINGS, INCLUDING POSTHOG SERVER HASH MODE, CAPTURED FIELDS, AND ANY OPTIONAL FEATURES. LIST ALL COOKIES AND OTHER BROWSER STORAGE IN USE, WITH THEIR PURPOSES AND DURATIONS. DESCRIBE THE CONSENT OR EXEMPTION POSITION AND ANY AVAILABLE PREFERENCE CONTROLS BEFORE FINALIZING THIS NOTICE.
- [ ] **Privacy: Who receives data.** CONFIRM OUR GOOGLE CONTRACTING ENTITY.
- [ ] **Privacy: Who receives data.** CONFIRM THAT THIS LIST COVERS ALL RELEVANT PROVIDERS, INCLUDING SUPPORT, INFRASTRUCTURE, AND ERROR MONITORING SERVICES.
- [ ] **Privacy: International transfers.** CONFIRM THE DATA PROCESSING TERMS IN FORCE FOR SCALEWAY, CLICKHOUSE, POSTHOG, AND POLAR. RECORD THE GOOGLE ADDENDUM VERSION ACCEPTED AND DOCUMENT THE TRANSFER SAFEGUARDS ACTUALLY RELIED UPON FOR EACH RELEVANT DATA FLOW, INCLUDING ANY REQUIRED TRANSFER ASSESSMENT.
- [ ] **Privacy: How long we keep data.** CONFIRM RETENTION AFTER ACCOUNT OR ORGANIZATION CLOSURE, INCLUDING RECORDS NEEDED BY OTHER ORGANIZATION MEMBERS.
- [ ] **Privacy: How long we keep data.** CONFIRM THE RETENTION PERIOD OR SPECIFIC CRITERIA USED TO DECIDE WHEN MESSAGES AND ATTACHMENTS ARE DELETED.
- [ ] **Privacy: How long we keep data.** CONFIRM RETENTION FOR POSTHOG, EVERR WEBSITE ANALYTICS, AND ANY SECURITY EVENTS OUTSIDE THE OPERATIONAL LOGS.
- [ ] **Privacy: How long we keep data.** CONFIRM THE APPLICABLE RECORDKEEPING REQUIREMENTS AND RETENTION PERIODS FOR EVERR'S OPERATOR. POLAR'S OWN RECORDS ARE GOVERNED BY ITS NOTICE.
- [ ] **Privacy: How long we keep data.** CONFIRM HOW DELETIONS ARE REAPPLIED IF A BACKUP IS RESTORED.
- [x] **Privacy: Changes and contact.** LEGAL NAME OF OPERATOR
- [x] **Dpa: Parties, scope, and roles.** LEGAL NAME OF OPERATOR
- [ ] **Dpa: Parties, scope, and roles.** CONFIRM PARTY IDENTITIES, CUSTOMER CONTACT RECORDS, THE FINAL VERSION AND EFFECTIVE DATE, AND HOW THIS DPA IS INCORPORATED AND ACCEPTED. LINKING A DRAFT DOES NOT MAKE IT EFFECTIVE.
- [ ] **Dpa: Processing locations and international transfers.** IDENTIFY THE OPERATOR'S ESTABLISHMENT, EACH SUPPLIER'S CONTRACTING ENTITY, ALL RELEVANT TRANSFERS, AND THE MECHANISMS ACTUALLY IN FORCE. COMPLETE ANY REQUIRED TRANSFER CLAUSES, MODULES, ANNEXES, AND ASSESSMENTS BEFORE THE RELEVANT TRANSFER. THIS DRAFT DOES NOT REPRESENT THAT TRANSFER CLAUSES HAVE BEEN EXECUTED.
- [ ] **Dpa: Return, deletion, and retained copies.** IMPLEMENTATION GAP: EARLY DELETION OF CUSTOMER TELEMETRY IS NOT YET VERIFIED AND MAY REQUIRE NEW CAPABILITY. VERIFY THE RETURN FORMAT AND PROCESS, REQUEST TIMING, DELETION METHOD AND COMPLETION TIME, DOWNSTREAM COPIES, AND DELETION CONFIRMATION BEFORE OFFERING THIS DPA FOR ACCEPTANCE. WAITING FOR THE NORMAL TELEMETRY RETENTION WINDOW TO EXPIRE, WHICH CAN BE ONE YEAR, IS NOT AN AGREED SUBSTITUTE FOR REQUIRED DELETION.
- [ ] **Dpa: Schedule 1: Processing details.** CONFIRM THE APPLICABLE PLAN, ACTUAL DATA FIELDS, SCALE AND RISK, AND ANY AGREED EXCEPTION BEFORE FINALIZING THE PROCESSING RECORD.
- [ ] **Dpa: Schedule 2: Security and assistance measures.** VERIFY ADMINISTRATOR MFA, ACCESS REVIEW AND REMOVAL PROCESS.
- [ ] **Dpa: Schedule 2: Security and assistance measures.** VERIFY ISOLATION ACROSS QUERIES, STORAGE, EXPORTS, AND SUPPORT ACCESS.
- [ ] **Dpa: Schedule 2: Security and assistance measures.** VERIFY INGESTION, APPLICATION, SUPPLIER AND ADMINISTRATIVE CONNECTIONS.
- [ ] **Dpa: Schedule 2: Security and assistance measures.** VERIFY ENCRYPTION COVERAGE AND KEY/SECRET MANAGEMENT.
- [ ] **Dpa: Schedule 2: Security and assistance measures.** COMPLETE THE DELETION/RETURN PROCEDURE.
- [ ] **Dpa: Schedule 2: Security and assistance measures.** VERIFY RECOVERY TESTS, BACKUP ACCESS, AND REAPPLICATION OF DELETIONS.
- [ ] **Dpa: Schedule 2: Security and assistance measures.** VERIFY PATCHING, CHANGE REVIEW AND SECURITY-TESTING PROCEDURES.
- [ ] **Dpa: Schedule 2: Security and assistance measures.** VERIFY LOG ACCESS, ALERTING, RESPONSE CONTACTS AND EXERCISES.
- [ ] **Dpa: Schedule 2: Security and assistance measures.** VERIFY SUPPLIER CONTRACTS AND ASSISTANCE PROCESS.
- [ ] **Dpa: Schedule 3: Subprocessors and locations.** CONFIRM CONTRACTING ENTITY AND EXACT SCOPE.
- [ ] **Dpa: Schedule 3: Subprocessors and locations.** CONFIRM CLICKHOUSE CONTRACTING ENTITY AND SELECTED AWS REGION.
- [ ] **Dpa: Schedule 3: Subprocessors and locations.** ASSESS SCALEWAY TRANSACTIONAL EMAIL, GOOGLE WORKSPACE, DISCORD, AND ANY OTHER SUPPORT, NOTIFICATION, OR OPERATIONAL PROVIDER THAT CAN RECEIVE CUSTOMER PERSONAL DATA. ADD THE RELEVANT ENTITIES AND FLOWS BEFORE ACCEPTANCE. WEBSITE ANALYTICS AND BILLING PROVIDERS ARE NOT AUTOMATICALLY TELEMETRY SUBPROCESSORS; CLASSIFY THEM BY ACTUAL PROCESSING.
