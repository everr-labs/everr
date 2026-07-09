# The security model: secret encryption at rest

This explains how clickety-clack protects the delivery secrets it stores — Slack
webhook URLs, PagerDuty routing keys, and subscription webhook URLs — and the
design decisions behind it. For the operator steps see
[manage secret encryption](../how-to/manage-secret-encryption.md).

## The threat being addressed

clickety-clack stores customer-supplied delivery secrets. A Slack incoming-webhook
URL or a PagerDuty routing key is a bearer credential: anyone who reads it can post
as that integration. These values must not sit in cleartext where a database dump,
a Redis snapshot, an audit-log export, or an error log could expose them.

The goal: **no customer delivery secret is ever persisted or logged in cleartext —
not in Postgres, not in Redis, not in the notification audit log, not in dead
letters, not in error messages.**

## What is protected, and where

| Secret | At rest in… | Protection |
| ------ | ----------- | ---------- |
| Slack URL, PagerDuty routing key, Telegram bot token (`channels.config`) | Postgres | AES-256-GCM encrypted |
| Subscription webhook URL (`subscriptions.webhook_url`) | Postgres | AES-256-GCM encrypted |
| The delivery target in the audit log (`notifications.target`) | Postgres | one-way `sha256:` digest (not recoverable) |
| The target in dead-letter records and logs | Redis / logs | redacted digest; transport errors strip the URL |

Note what is **not** treated as secret: plain webhook receiver URLs and email
recipient addresses are structural configuration, stored as-is. Only the three
bearer-credential cases above are encrypted.

## Encryption at the storage boundary

Encryption is applied where data crosses into storage, not sprinkled through the
code:

- The **store** encrypts the secret fields of each channel config (and
  subscription URL) on write and decrypts on read. Application code above the store works with
  cleartext; the database only ever sees ciphertext.
- The **dispatcher** buffers only channel NAMES into the Redis group and
  resolves them through the store at flush time, just before delivery. No
  secret (encrypted or otherwise) is ever written to Redis.

This keeps the secret in cleartext only transiently in memory at the moment of
use, and never on any durable medium.

## Two cipher providers

A `SecretCipher` abstraction (AES-256-GCM) has two implementations, chosen by
`CC_SECRET_PROVIDER`:

- **EnvKeyring (`env`)** — versioned static keys supplied via `CC_SECRET_KEYS`,
  with one designated active key. Each ciphertext carries the id of the key that
  produced it, so old keys remain usable for decryption after rotation. This is
  the production-simple path.
- **FakeKms (`kms`)** — envelope encryption: each secret gets a freshly generated
  data key that encrypts the payload and is itself wrapped under a root key and
  stored alongside the ciphertext. It deliberately mirrors the AWS-KMS
  `GenerateDataKey`/`Decrypt` shape, so a real cloud KMS can replace it later
  without changing the on-disk envelope format.

Every ciphertext is a self-describing **envelope** (version, key id, nonce,
ciphertext, and — for KMS — the wrapped data key), so the right key and method are
always selected on read. Nonces are random per encryption, which is why
deduplication keys are computed over cleartext, not ciphertext (the same secret
encrypts to different bytes each time).

## Fail-closed by construction

The cipher is built **before any role logic**, unconditionally. If the key
material is missing or invalid, the process exits at startup with a clear error —
it never falls back to writing or reading cleartext. This means a forgotten key
turns into a loud, immediate failure rather than a silent security hole. Even roles
that never touch secrets (a scheduler) build the cipher, so misconfiguration can't
hide on a subset of your fleet.

## Keeping secrets out of the audit trail

Encryption protects the *stored* secret, but a secret can also leak through
*observability*: an audit row, a dead-letter record, an error log. clickety-clack
closes those paths too:

- The notification audit log stores the target as a one-way `sha256:` digest, not
  the secret. It's enough to deduplicate and correlate, impossible to reverse.
- Dead-letter records and log lines use the same redacted digest.
- HTTP transport errors are stripped of their URL before being recorded — without
  this, a connection error would embed the secret webhook URL in
  `notifications.last_error` and the dead-letter stream. This was a real leak path
  the design specifically closes.
- A flush-time decrypt failure dead-letters the affected batch (observable,
  recoverable) rather than dropping it or logging the secret.

The net effect: logs, audit exports, and dead-letter dumps are safe to ship to
lower-trust systems.

## Rotation and its limits

Because each ciphertext records its key id and all configured keys are available
for decryption, rotation is graceful: add a new key, make it active, and new
writes use it while old data still decrypts. Re-encrypting old rows means writing
them again (re-`POST` the receiver) — there is no bulk re-key. A key id must not be
removed while any stored ciphertext still references it, or that row becomes
undecryptable. See the [rotation how-to](../how-to/manage-secret-encryption.md#rotate-keys-env-provider).

The flip side of strong encryption is **key custody**: lose the key material and
the secrets it protected are unrecoverable. Key material belongs in your secret
manager, backed up, never in the repository.

## Design summary

| Decision | Rationale |
| -------- | --------- |
| Encrypt at the storage boundary | Single choke point; app code stays cleartext; storage never sees plaintext. |
| Self-describing envelopes with key id | Enables rotation; right key chosen automatically on read. |
| Two providers behind one trait | Simple static keys now; drop-in cloud KMS later, same envelope. |
| Fail-closed at startup | A missing key is a loud failure, never a silent cleartext fallback. |
| Digest (not encryption) for the audit target | Audit needs correlation, not recovery; a one-way digest can't leak. |
| Strip URLs from transport errors | Closes the observability leak path that encryption alone misses. |

## A separate boundary: untrusted rule SQL

Secret-at-rest encryption is one of *two* security boundaries. The other is **rule
SQL**, which is tenant-authored, untrusted input executed against ClickHouse.

The in-app SQL guard (the `sqlguard` module) is **not** that boundary — it only checks the
statement *shape* (a single, parseable, read-only `SELECT`), and the per-query
`readonly=1` setting only blocks writes. Neither stops a valid `SELECT` from
reading data it shouldn't or reaching the network: ClickHouse table functions
(`url`, `file`, `s3`, `remote`, …) make SSRF and data exfiltration expressible as
ordinary reads, and `system.*` tables expose cross-tenant and cluster data. Those
are reads, so `readonly=1` permits them.

The real boundary is the **ClickHouse user's privileges** — a least-privilege user
with `SELECT` only on the alerting database, **no `SOURCES` grants** (which denies
the dangerous table functions), no `system` access, plus settings constraints,
quotas, and network egress controls. That is operator configuration and is not
done for you; treat the in-app guard as convenience and defense-in-depth, never as
the boundary. See [Harden the ClickHouse user](../how-to/harden-clickhouse-access.md).

## Webhook targets and tenant scoping

Two more boundaries follow the same pattern (validate what the engine can,
name what the deployment must do):

**Tenant-supplied webhook URLs** (subscriptions, `webhook` receivers) are
fetched by the dispatcher from inside the deployment network, so they are an
SSRF surface. The API rejects at create time everything statically
recognizable as internal: non-HTTP schemes, userinfo, `localhost`, and IP
literals in private, loopback, link-local, or metadata ranges (see the
[HTTP API reference](../reference/http-api.md#subscriptions-firehose-webhooks)).
What it deliberately does not do is resolve DNS: a create-time resolver check
is TOCTOU-broken (DNS rebinding), so hostnames that resolve to internal
addresses must be stopped by deployment-level egress policy on the dispatcher's
network. `CC_ALLOW_PRIVATE_WEBHOOKS=1` is the dev-only escape hatch.

**Tenant scoping is defense in depth in the store layer**: every Postgres query
on a tenant-owned table (rules, instances, subscriptions, receivers, routes,
silences, inhibitions, notifications) carries a tenant predicate, even where
the caller already resolved the row tenant-scoped. A bug that leaks a foreign
id into a code path therefore reads or writes nothing instead of crossing
tenants. On the API side, `CC_API_KEYS` supports tenant-bound entries
(`<key>@<tenant-id>`) so a leaked per-tenant key cannot assert another tenant
via `X-CC-Tenant`; unbound keys (everr's backend) retain full tenant choice.
The remaining trust assumption, that the caller of an unbound key asserts
tenants honestly, is inherited from the phase-1 header-trust model and goes
away when real everr auth replaces `HeaderAuth`.

## See also

- Operator steps: [manage secret encryption and rotate keys](../how-to/manage-secret-encryption.md).
- Lock down rule SQL: [harden the ClickHouse user](../how-to/harden-clickhouse-access.md).
- Variables: [configuration → secret encryption](../reference/configuration.md#secret-encryption--required).
- Where encryption sits in delivery: [the dispatch pipeline](dispatch-pipeline.md).
