# Optional CRM campaign delivery design

Status: specification independently reviewed on October 23, 2026 and included
with this specification commit.
No event exporter, recipient dispatcher, campaign or automation is implemented
or enabled by this document. This optional work does not block the current CRM
projection rollout. See [ticket 16](../todo/issues/brevo-crm/tickets/16-optional-campaign-delivery-design.md),
the [integration plan](brevo-crm-integration-plan.md) and [operations runbook](crm-operations.md).

## Boundaries and evidence

The existing projection synchronizes current User, Organization and Membership
state. Bootstrap and reconciliation repair that state, including Company milestone
attributes. They must never synthesize historical events or enqueue welcome events.
The task 14 isolated provider canary proved profile fields and associations, not
Events API delivery, duplicate suppression or automation entry. Its reviewed
application commit is `54c768cac`. Task 15's separate `everr-deploy` commit
`1df983b` prepares disabled-default configuration; target schema delivery, CI
adoption, durable settings, target canary and actual rollout remain future gates.

This design preserves `events.publish(event): void` after a successful source
commit, followed by independent best-effort consumer enqueue. It adds no source
transaction parameter, UnitOfWork, operation recorder or generic fact outbox.
If publication or enqueue is lost, current-state repair cannot recover a complete
transition history or the original envelope ID/time. A retained milestone timestamp
alone does not reconstruct the lost event. Only a retained event-export job can
preserve its original event envelope across delivery retries.

## Facts, actors and recipients

The current schemas and publishers establish these limits:

| Source                                                                                                                                     | Facts actually available                                                                                                                                           | Recipient implication                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Identity facts](../packages/app/src/identity/events.ts)                                                                                   | User subject/data IDs; Organization IDs; Membership, User and Organization IDs. The schemas allow optional `actorId`, but the current helper constructors omit it. | A User subject identifies a possible subject-recipient, never proof that the User performed an administrative action. Membership's User is the relationship endpoint, not necessarily its actor. |
| [Readiness fact](../packages/app/src/organizations/events.ts)                                                                              | Organization ID only; no actor field.                                                                                                                              | Provisioning completion identifies no human recipient or activity.                                                                                                                               |
| [Billing facts](../packages/cloud/src/billing/events.ts)                                                                                   | Organization and subscription IDs, or previous/current Plan. Optional actor is allowed, but the Plan helper omits it.                                              | No invented billing actor. Subscription change is a notification to inspect current state, not an immutable billing delta.                                                                       |
| [Milestone facts](../packages/app/src/organizations/consultations.ts) and [publication](../packages/cloud/src/organizations/milestones.ts) | Organization ID, rule version and `observedAt`; no actor. First-queryable and activation currently use the same successful observation.                            | Organization achievement is known. Who achieved it is unknown in the exported fact. `observedAt` is server observation admission time, not first ingestion or raw telemetry time.                |
| [Consultation evidence](../packages/app/src/organizations/consultations.ts)                                                                | An authenticated Member principal includes User/Membership IDs; an authorized client principal includes client/Organization IDs, with no User.                     | This richer input is not retained in milestone facts. A client cannot be mapped to the current Owner as its actor.                                                                               |

Initial export allowlist: empty. A future implementation may propose a narrow
allowlist of retained, versioned facts with sufficient immutable meaning. Generic
`updated` notifications do not become historical snapshots by loading today's
profile. Deletion/removal facts are cleanup signals by default, not campaign
requests. Source capture enrichment, if needed for a campaign, is a separate
reviewed change; this specification requires no change to current business facts.

There are two distinct recipient policies, both disabled until separately approved:

1. Subject communication can target the known User subject of an allowlisted User
   lifecycle fact. Store `subjectUserId` separately from optional `actorId`. Preserve
   a supplied actual actor, or its absence; never copy the subject into the actor.
2. Organization communication can notify eligible current Owners under an explicit
   versioned policy such as `current_owners_v1`. This means "your Organization
   reached a milestone", never "you performed the action". Preserve the source
   Organization and known actor independently of recipient IDs. An actor-free
   milestone remains actor-free even if the recipient happens to be its Owner.

Resolve a bounded candidate set when admitting communication work. Record each
candidate and policy version, then revalidate User existence and communication
eligibility before outbound delivery. Organization-scoped communication also requires
authorized current Membership/role in that Organization; a User-subject fact need
not have an Organization. Do not expand a queued set to newly joined Owners.
Revoked required access, missing required Membership, unknown preference, stale verification or opt-out suppresses delivery
with a reason. Do not rewrite historical actor facts or undo source activation.
If an actor lacks current access, preserve the historical fact but suppress
communication that requires that access. Never fan activity out to all Members.

## Documented provider contract and design decisions

Brevo's single Events endpoint is `POST /v3/events`: `event_name` accepts
alphanumeric characters, hyphens and underscores, up to 255 characters; at least
one contact identifier is required. `event_date` accepts ISO 8601 and defaults to
creation time when absent. `event_properties` supports structured event data with
restricted keys and a 50 KB limit. `contact_properties` can update Contact state.
Success is `204 No Content`. The documented request exposes no general event-ID
deduplication key. [Create an event](https://developers.brevo.com/reference/create-event).

The documented identifier choices include `contact_id`, `email_id`, `phone_id`,
`whatsapp_id`, `ext_id` and `landline_number_id`; `contact_id` takes precedence
when present. Event reads support contact/name/date filters and pagination and
return event properties. These are inspection facilities, not documented atomic
deduplication or immediate-visibility guarantees. [Event endpoints](https://developers.brevo.com/docs/event-endpoints).

Proposed request mapping, to be verified before implementation enablement:

| Field                          | Local policy                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event_name`                   | Explicit versioned allowlist, for example `everr_organization_activated_v1`; do not forward dotted internal types verbatim.                                                                                                                                                                                                     |
| `identifiers`                  | Exactly one verified mapped `contact_id` for the eligible recipient. Verify its deployment-scoped external identity; do not resolve by mutable email or include competing identifiers. Missing/stale mapping blocks the export; the exporter never creates a Contact.                                                           |
| `event_date`                   | Original retained envelope `occurredAt`, unchanged on retries. Keep milestone `observedAt` separately. Never substitute retry time for historical occurrence time.                                                                                                                                                              |
| `event_properties`             | Bounded, reviewed fields: `everr_event_id`, `everr_event_type`, `everr_event_version`, `everr_subject_id`, `everr_organization_id` when present, known `everr_actor_id` only, `everr_recipient_user_id`, `everr_recipient_policy`, `everr_delivery_origin`, and required immutable fact data under an explicit field allowlist. |
| `contact_properties`, `object` | Omit. Profile mutation belongs to profile sync; a Brevo Custom Object is not implicitly an Everr Organization/Company.                                                                                                                                                                                                          |

The underscore prefix above is provider payload naming constrained by that API,
not an OTel attribute namespace. These properties are proposed correlation data,
not a claim that Brevo suppresses repeats of `everr_event_id`. Keep payloads well
below the provider size limit. Batch delivery is out of initial scope.

Brevo custom-event triggers can enroll a Contact in an automation. Event and
Contact filters can restrict entry, including subscription status; multiple
triggers are alternatives, so one permissive trigger can admit a Contact.
[Available triggers](https://help.brevo.com/hc/en-us/articles/15445989568402-Available-triggers-actions-and-rules-in-an-automation),
[Trigger filters](https://help.brevo.com/hc/en-us/articles/21203352470034-Use-a-trigger-to-start-an-automation).
Re-entry after exit, wait time, exit and restart conditions are configurable.
These are audience controls, not an event-ID exactly-once contract.
[Audience conditions](https://help.brevo.com/hc/en-us/articles/19649907878546-Define-and-manage-the-audience-entry-and-exit-conditions-for-an-automation).

## Separate export consumer and durable delivery receipt

A future cloud-only subscriber should persist an immutable export job, independently
of the replaceable current-profile job. Use a unique delivery identity containing
deployment/account scope, original event ID, consumer/schema version, recipient
User and recipient-policy version. Do not collapse different facts under a User
or Organization job key. Retain the original envelope, minimal allowlisted data,
candidate recipient, origin and a payload digest. Same identity with different
immutable data blocks as a conflict. Scope retention and deletion of recipient
data in that implementation; do not persist raw query results or credentials.

The receipt is local consumer delivery state, not a generic source fact log.
Serialize attempts by delivery identity across replicas and persist a fenced
attempt marker before HTTP. Keep event-export receipts, retry allowances and
failure reasons separate from profile revisions. Profile success never retries
an event, and event failure never repeats profile sync. A profile mapping
dependency may be inspected/deferred without recreating or resubscribing Contacts.

Proposed receipt transitions:

- `pending` becomes `suppressed` after failed eligibility, or `attempting` after
  successful mapping/preference validation and a provider-budget permit.
- A committed, documented success becomes `accepted`, meaning provider HTTP
  acknowledgement only. It does not mean automation entry, delivery or consent.
- A definite non-accepting rejection can become `deferred` with bounded persisted
  backoff, or `blocked` for permanent input/credential errors. Confirm each retry
  classification against future adapter/provider evidence; never treat every
  5xx as a safe event POST retry.
- Any possibly accepted POST, lost acknowledgement, malformed response after
  sending, or abandoned `attempting` receipt becomes `unknown`. No automatic
  resend, including after process restart, lease expiry or Graphile replay.

An operator may investigate `unknown` with a bounded, quota-accounted read
procedure using the original Contact, event name, occurrence window and correlation
property. A matching observation is evidence of acceptance, not uniqueness of
remote effects. No visible match is insufficient proof of rejection. Exhausted
inspection stays unknown; the conservative terminal choice is no resend, with a
recorded delivery gap. Any future exceptional resend requires an explicit decision
that accepts duplicate risk, preserves the original identity/time and records its
reason. It must never be a general "retry all failed events" command.

Durable enqueue admits repeat worker execution, but local uniqueness and receipts
only reduce repeated remote attempts. A crash after provider acceptance and before
receipt commit still leaves uncertainty. No exactly-once remote event, automation
entry or message guarantee is offered. Historical delivery completeness is also
impossible after pre-enqueue loss under the accepted publication contract.

## Backfill, preferences and revocation

Bootstrap, reconciliation and profile sync emit zero historical/welcome events.
The initial exporter accepts only new retained facts admitted after an explicit
cutover. Old queued facts are not silently promoted. Historical archive export,
if ever authorized, requires a separate path/account with no messaging automation;
`everr_delivery_origin=backfill` alone is not a remote safety boundary.

Profile creation or updates can make a Contact match provider filters independently
of Everr's Events API. This is an inference from Brevo's documented scheduled
Contact-filter and segment triggers. Before importing profiles or enabling any
future communication, audit all relevant account automations, including legacy
ones, and disable or exclude imported Contacts from every messaging entry path.
Do not claim that omitting list IDs and event export alone prevents welcome mail.
[Filter and segment triggers](https://help.brevo.com/hc/en-us/articles/15445989568402-Available-triggers-actions-and-rules-in-an-automation).

The existing [adapter policy](../packages/cloud/src/crm/brevo/README.md) creates
suppressed Contacts, preserves opt-outs and conservatively suppresses an email
change. Event export must never set suppression false, add lists, invoke a separate
automation-enrollment operation, write consent attributes, or use `contact_properties` to undo that
policy. CRM presence, email verification, Organization role and Plan establish no
marketing permission. The future communication policy needs an explicit source
of purpose/channel eligibility; absent or conflicting evidence fails closed.

Brevo distinguishes marketing channel subscription from transactional preferences
and supports channel-specific blocklisting. Do not assume email permission grants
SMS permission, or that one blocklist covers all channels.
[Communication preferences](https://help.brevo.com/hc/en-us/articles/5317448358034-Blocklist-unblock-or-resubscribe-contacts).
Recheck current source authorization and relevant provider preferences immediately
before POST. Later opt-out, departure or deletion suppresses pending work. For
already accepted work, local checks cannot retract an autonomous remote send:
future automation must enforce current preferences and revocation at action time
and prove that behavior without sending messages before approval. Until then,
automatic marketing delivery remains blocked. Activation truth remains unchanged.

## Scenario review and missing provider verification

These are synthetic design cases, not executed runtime tests or live provider
results. All remote duplicate/entry/action outcomes below remain unverified.

| Scenario                                                   | Required local behavior                                                                   | Remote question for a later no-message experiment                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Duplicate publication of the same retained envelope        | Same delivery identity admits one immutable job/receipt; differing payload blocks.        | Does repeated identical POST create repeated events/entries?             |
| Two different Plan transitions for one Organization        | Separate IDs/jobs; no merge into one latest-state event.                                  | Which event data does each entry retain?                                 |
| Crash before attempt marker/HTTP                           | Retry pending work after fresh eligibility checks.                                        | None assumed.                                                            |
| Crash after attempt marker, before or during HTTP          | Abandoned attempt is unknown; no blind resend.                                            | Can bounded readback establish acceptance? Absence still proves nothing. |
| Provider accepted, acknowledgement lost                    | Unknown; original ID/time retained; bounded inspection, then no-resend gap if unresolved. | Visibility delay and correlation readback behavior.                      |
| 204 received, process crashes before receipt commit        | Same unknown handling, not another POST.                                                  | Duplicate entry and restart behavior are unknown.                        |
| Accepted receipt, job executes again                       | No POST; retain acceptance evidence.                                                      | Acceptance is not a message delivery receipt.                            |
| Pre-enqueue loss or missing historical event               | Current-state repair only; no fabricated ID, time or welcome event.                       | No provider experiment can restore the lost local fact.                  |
| Bootstrap creates suppressed Contacts and milestone fields | No event-export jobs; require account automation audit before target import.              | Can creation/attribute/segment entry occur despite no Events POST?       |
| Missing actor, or authorized client with no User           | Preserve Organization; omit actor; only explicit recipient policy can choose a human.     | No inferred human activity.                                              |
| Owner removed or recipient opted out while queued          | Suppress before POST, no replacement recipient expansion.                                 | Pending remote entry/action revocation behavior after an earlier POST.   |
| Email changed or provider mapping replaced                 | Recheck verified mapping and suppression; mismatch blocks; no email fallback.             | Confirm no unintended resubscription or delivery.                        |
| Source deletion after acceptance                           | Cancel local pending work; preserve sanitized receipt under future retention policy.      | Can queued remote actions be prevented without a message?                |
| Profile sync fails while event export succeeds, or reverse | Independent state and failures; neither replays the other's work.                         | No coupled provider effect assumed.                                      |

Official documentation was reviewed on October 23, 2026. No Brevo credentials,
Events request, automation creation, campaign, list, invitation or actual message
was used for ticket 16. Task 14's owned profile canary does not close these gaps.
The design ticket can finish with these gaps recorded; runtime/remote verification
and automatic marketing remain blocked until a separately authorized experiment.

That future experiment must use an isolated account and owned synthetic Contacts,
an audited workflow with no sending, webhook or automation-chaining actions, bounded
quota use and recorded exact readbacks/entry logs. Audit the whole account so profile
or event changes cannot enter another messaging workflow. Exercise identical POSTs,
separate event IDs, original past dates, acknowledgement loss, re-entry settings,
backfill exclusion, preferences and revocation. Record what each observation
proves, its visibility limit and cleanup. If no-message inspection cannot prove
a required action-time safeguard, keep that safeguard unverified and blocked.

## Future commit and activation boundaries

1. Separately review source enrichment only if an approved campaign needs facts
   currently missing. Do not infer them during profile repair.
2. Implement a cloud-only disabled exporter, local receipt/recovery model, bounded
   budgets and behavioral failure tests. Keep self-hosted independent; deliver
   schema through the normal reviewed process without generating migrations here.
3. Perform the separately authorized no-message provider experiment and review its
   actual evidence. Any new telemetry must follow OTel semconv, use `everr.` for
   custom attributes and have Everr ingestion verified.
4. Review an explicit communication purpose, recipient policy, consent workflow,
   templates, current-access revocation controls and account automation inventory.
   Campaign activation and any real message require separate authorization and
   target-specific rollout proof. Neither CRM configuration nor this spec enables it.
