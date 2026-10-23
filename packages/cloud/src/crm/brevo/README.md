# Brevo HTTP adapter

Task 06 supplies an inert cloud-only provider adapter, configuration validation and
shared request permits. No CRM subscribers, runners or startup HTTP are registered.
The adapter emits no telemetry and never logs requests, provider bodies or errors.
Its failure values contain only bounded local codes, HTTP status, scheduling time
and, when available, an accepted remote ID. The transport seam permits deterministic
HTTP tests without credentials. Redirects are rejected so credentials cannot follow
a provider redirect.

## Configuration and scheduling

`readBrevoConfig` reads these cloud environment fields:

| Field                     | Meaning                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `CRM_BREVO_MODE`          | `disabled` (default), `configured`, or `paused`                                                                                       |
| `CRM_BREVO_API_KEY`       | Secret, required in configured and paused modes                                                                                       |
| `CRM_BREVO_DEPLOYMENT`    | Permanent deployment namespace used by projection snapshots                                                                           |
| `CRM_BREVO_ACCOUNT_SCOPE` | Stable nonsecret account identifier shared by every replica and deployment using the same Brevo account, including different API keys |
| `CRM_BREVO_TIMEOUT_MS`    | HTTP deadline including body consumption, default 10000, valid range 100 through 30000 milliseconds                                   |

Disabled mode requires no credentials and returns a disabled outcome without I/O.
Configured and paused modes validate all configuration at cloud startup, unless the
existing build-only environment-validation bypass is set. Importing modules and
constructing an adapter make no provider calls. Paused operations return `ok: false`
and `kind: paused`; later consumers must preserve pending work rather than acknowledge
it as synchronized. Changes to mode take effect when configuration is reconstructed.
No production activation or environment values are included here.

`createBrevoBudget` uses atomic PostgreSQL upserts and `clock_timestamp()` on the
cloud `crm_brevo_budget` table. A permit is consumed before each actual HTTP attempt,
including reads, recovery, cleanup and failed requests. Contact operations are
spaced by at least 100 milliseconds, respecting 10 requests/second and 36000/hour.
Otherwise-general operations, including companies and their associations, share
one permit every 36 seconds, respecting 100/hour. All clients using the account
must share the same database and account scope. Separate deployments with separate
databases need separate Brevo accounts or external account-wide coordination.
Traffic outside this adapter also consumes provider quota; exhausted-capacity and
429 responses extend a shared cooldown. Fixed worker concurrency alone is insufficient.
Exhausted-capacity headers are honored for malformed responses and definitive
rejections as well as successful responses. A known failure retains its sanitized
classification if cooldown storage fails or exceeds the HTTP deadline.

Denied acquisition returns `rate_limited` and `retryAt` immediately. It does not
advance the next permit, sleep, enqueue or accumulate an in-process backlog.
Consumers must durably defer work to at least that time. Brevo's reset header is
remaining seconds, not a Unix timestamp. The adapter honors the longer of its
reset and `Retry-After` (seconds or HTTP date), with a conservative fallback
when reset information is missing. Budget
failures are sanitized and fail closed. No application/source transaction is held
while waiting for, or making, provider requests. The schema source is supplied
without generating or applying application migrations.

## Identity, field ownership and communication preferences

Contacts use stable deployment-scoped `ext_id`, read through `identifierType=ext_id`.
The adapter writes only `EVERR_NAME` (text), `EVERR_REGISTERED_AT` (text containing the
original ISO timestamp), and `EVERR_EMAIL_VERIFIED` (boolean). Email changes use
`attributes.EMAIL`; names and email never determine external identity. Contact
creation explicitly disables update-or-create, requests email/SMS suppression and does
not add lists, campaigns, consent groups or automations. Contact updates explicitly
set `forceMerge: false`.

Load a contact separately before updating, under the future entity synchronization
lock. This keeps permit deferrals between read and write resumable. Pass that
current record to `updateContact`, which checks its external identity. It never
writes a false suppression flag. Email changes always include
`emailBlacklisted: true` in the same PUT, even if the old email was allowed. This
conservative policy prevents a concurrent email opt-out from being undone by the
provider's documented email-change behavior. An existing SMS opt-out is also sent
as true. No unblock-then-reblock sequence is used. Notes, consent, preferences,
lists and unrelated attributes are omitted. A future consent workflow, with its own
explicit authorization, must handle any deliberate resubscription.

Companies retain Brevo's generated ID and a stable Everr external ID attribute.
The isolated API verified that the label `EVERR_ORG_ID` creates internal name
`everr_org_id`. The same lower-case mapping applies to `EVERR_CREATED_AT`,
`EVERR_PLAN`, `EVERR_APP_STATE`, `EVERR_SUBSCRIPTION_STATUS`,
`EVERR_CURRENT_PERIOD_END`, `EVERR_CANCEL_AT_PERIOD_END` and `EVERR_PROVISIONING`.
All eight company fields are text; dates retain ISO precision, cancellation uses
`true`/`false`, and absent nullable source fields clear to an empty string. The
provider's own `created_at` is read-only and is never used as Everr's creation date.
Only these fields and the source-owned company name are written. A company PATCH
accepts documented 200 with a validated company body or verified 204 with no body.
Read back with `getCompany` when current provider values are needed.

Associations use explicit numeric Contact IDs and Company IDs through the
link/unlink endpoint. They add or remove only the requested pair, without replacing
all associations or matching email domains. Future synchronizers own mapping
validation and entity serialization, including deletion races, across replicas.

## Errors and uncertain creates

The adapter makes no automatic retries. Network errors, HTTP deadlines and
408/425/5xx are transient for reads/idempotent writes. For a create, these outcomes
are `ambiguous_create`, because the provider may already have committed it. A
successful create with a lost/malformed response is also ambiguous. If an accepted
ID was parsed before a later cooldown persistence failure, the failure carries
`remoteId` so the handler can bind it before recovery. A caller must persist a
create-attempt guard before issuing POST, retain uncertain outcomes, and never
translate an ambiguous result into another blind POST. Consumers and this durable
execution policy belong to tasks 07 and 08.

429 returns a rate-limited outcome. Credential/schema errors remain inspectable
permanent failures. 404 is explicit `not_found`, allowing deletion handlers to
acknowledge an already absent mapping deliberately. 409 and bounded duplicate
identifier codes are `identity_conflict`, never an instruction to merge. In the
isolated account an actual duplicate-email update returned 400 `invalid_parameter`.
That code also covers invalid input, so it remains `permanent/provider_rejected`
without guessing from provider prose. The conflicting contacts are not merged.

`recoverCompany` reads one unfiltered inventory page, up to 100 records, compares
`attributes.everr_org_id` locally, and returns a unique visible matching ID only
when the returned page has fewer than 100 records. A full page is blocked as
`recovery_inventory_limit`. Several matches are an identity conflict. No visible
match remains `recovery_not_visible`, because an empty view cannot prove a POST
failed or that provider visibility is immediate. These outcomes require retained,
inspectable work and a bounded operator recovery process, not another create.

The isolated two-company check showed that a custom-attribute filter was ignored:
`filters[attributes.everr_org_id]` returned both companies with only one local
match. The adapter does not depend on that undocumented filter. Bounded inventory
recovery is deliberately limited; it provides no general duplicate-free or
exactly-once create guarantee, and cannot exclude later external concurrent edits.

## Verification

Behavioral tests cover transport/body deadlines, cancellation, classification,
credential/payload redaction, conflict handling, suppression, owned-field mapping,
validated success variants, bounded recovery, and shared DB quota/cooldowns across
separate store instances. Provider verification uses only isolated, clearly owned
fixtures and records sanitized evidence. Contact IDs/external IDs and email
suppression survived rename/email changes. Company recovery succeeded after a
simulated lost successful POST without another create. Company PATCH/readback
verified owned attributes, and link/unlink GETs verified explicit association
changes. All fixture records were deleted successfully; required Everr-only custom
fields remain in the authorized isolated account. Final aggregate reads returned
zero companies and one preexisting contact, matching the preflight baseline.
Email-only fixtures had SMS
suppression false before and after, so real phone-based SMS behavior is not claimed.
No new telemetry is introduced, so the
publisher's earlier ingestion proof is unchanged. No UI is changed and `.auth` is
absent, so authenticated manual app checks are skipped.

Primary contracts checked October 23, 2026: [contact creation](https://developers.brevo.com/reference/create-contact),
[contact update](https://developers.brevo.com/reference/update-contact),
[contact lookup](https://developers.brevo.com/reference/get-contact-info),
[company creation](https://developers.brevo.com/reference/create-a-company),
[company inventory](https://developers.brevo.com/reference/get-all-companies),
[company update](https://developers.brevo.com/reference/update-a-company),
[explicit associations](https://developers.brevo.com/reference/link-and-unlink-company-with-contact-and-deal),
[rate limits](https://developers.brevo.com/docs/api-limits), and
[reset headers](https://developers.brevo.com/docs/limit-headers).
