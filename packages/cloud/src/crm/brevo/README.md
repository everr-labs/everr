# Brevo HTTP adapter

The adapter owns transport, field ownership, response validation and rate-limit
backpressure. Its construction makes no HTTP calls. Tests inject a transport;
production always uses the fixed Brevo API origin with redirects rejected.

## Configuration

- `CRM_BREVO_MODE`: `disabled` by default, or `configured`.
- `CRM_BREVO_API_KEY`: required in configured mode.
- `CRM_BREVO_TIMEOUT_MS`: per-request deadline including body consumption, default
  10000 ms, accepted range 100 to 30000 ms.

Production Cloud and local development use different accounts. No deployment
namespace, account-scope variable or persistent request budget is required.
Disabled adapters return without network calls.

## Requests and backpressure

Responses are limited to 256 KiB per request. Malformed bodies and stalled
transport/body reads produce bounded classifications. Provider prose, credentials,
URLs and raw exceptions do not escape through failure values.

An explicit 429 rejection is retried after the longer provider reset or Retry-After
delay. A missing reset uses 60 seconds. Each wait emits a bounded operation label,
delay and next-attempt time. Waiting is cancellable and occurs inside the dedicated
serialized CRM queue, without holding a source transaction. There is no proactive
account-wide quota store. All other retries belong to Graphile.

Reads and idempotent writes classify timeouts, 408/425 and 5xx as transient.
POSTs with unknown outcomes classify as ambiguous creates. Credentials, invalid
input and identity conflicts are terminal. A 404 is explicit so callers can treat
an already deleted record as success or look up a missing Company mapping.

## Identity and owned fields

Contacts use `ext_id=everr:v1:user:<encoded-id>` and lookup with
`identifierType=ext_id`. Creation sets `updateEnabled: false` and leaves email
and SMS preferences to Brevo without overriding them. Updates set
`forceMerge: false`, never clear suppression, and suppress a changed email
conservatively. No lists, campaigns, automation enrollment, consent
or unrelated profile fields are written.

Owned Contact attributes are `EVERR_NAME`, `EVERR_REGISTERED_AT` (ISO text) and
`EVERR_EMAIL_VERIFIED` (boolean), alongside the email address.

Companies use `everr_org_id=everr:v1:organization:<encoded-id>`. Owned text
attributes are `everr_created_at`, `everr_plan`, `everr_app_state`,
`everr_subscription_status`, `everr_current_period_end`,
`everr_cancel_at_period_end` and `everr_provisioning`, plus the Company name.
The standard name is normalized from `attributes.name` on reads. PATCH accepts
validated 200 and empty 204 acknowledgments. Unchanged owned fields are omitted.

Company inventory is paginated and matched locally by exact external identity;
custom-attribute filtering is not assumed. Duplicate identities are terminal.
Contact inventory uses offset pagination and accepts records without Everr IDs.
Associations add/remove one explicit pair without replacing unrelated links.

Company POST has no idempotency guarantee. Callers perform lookup before creation,
stop on ambiguous outcomes and recover through later lookup. No durable attempt
guard or persistent response cache is maintained. See the
[operations runbook](../../../../../docs/crm-operations.md) for manual recovery.
