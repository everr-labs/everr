# How to manage secret encryption and rotate keys

clickety-clack encrypts delivery secrets at rest (Slack, Discord, and webhook
channel URLs, Telegram bot tokens, subscription webhook URLs). Secrets live only in Postgres: Redis
group metas carry channel names, which the flusher resolves through the store at
delivery time. It is **fail-closed**: without a valid key, no role starts. This guide
covers configuring keys, rotating them, and the operational implications. For the
design rationale see [the security model](../explanation/security-model.md).

## Choose a provider

`CC_SECRET_PROVIDER` selects the cipher:

| Provider | When to use | Required vars |
| -------- | ----------- | ------------- |
| `env` (default) | Keys supplied directly as env vars. Simple, good for most deployments. | `CC_SECRET_KEYS`, `CC_SECRET_ACTIVE_KEY` |
| `kms` | Envelope encryption (a fresh data key per secret, wrapped under a root key). Mirrors the AWS-KMS data-key-wrap path so a real KMS can drop in later. | `CC_KMS_FAKE_ROOT_KEY` |

## Set up the `env` provider

A key is a base64-encoded **32-byte** (AES-256) value with an id. Generate one:

```bash
openssl rand -base64 32      # → e.g. 3Qb…==   (a single key's material)
```

Configure a keyring and pick the active key:

```bash
export CC_SECRET_PROVIDER=env
export CC_SECRET_KEYS="v1:3Qb…=="     # id:base64key[,id2:base64key2,…]
export CC_SECRET_ACTIVE_KEY=v1        # which id encrypts NEW secrets
```

- **All** listed keys are available for **decryption**.
- Only `CC_SECRET_ACTIVE_KEY` is used to **encrypt** new secrets.
- Each stored ciphertext records the key id that produced it, so the right key is
  always selected on read.

## Set up the `kms` provider

```bash
export CC_SECRET_PROVIDER=kms
export CC_KMS_FAKE_ROOT_KEY="$(openssl rand -base64 32)"
```

Each secret gets a freshly generated data key; the data key encrypts the secret
and is itself wrapped under the root key and stored alongside the ciphertext.

## Verify fail-closed behavior

With the `env` provider and no keys, the process must refuse to start:

```bash
env -u CC_SECRET_KEYS CC_ROLE=api CC_SECRET_PROVIDER=env ./cc; echo "exit=$?"
# Error: config: CC_SECRET_KEYS required for env provider
# exit=1
```

(The ClickHouse default-user guard runs first, so with an unhardened
`CC_CH_USER` the process exits with that error instead; the check above assumes
a [hardened ClickHouse user](harden-clickhouse-access.md).)

This is intentional: it guarantees secrets are never written or read in cleartext
because a key was forgotten. Other fail-closed messages are listed in the
[configuration reference](../reference/configuration.md#fail-closed-error-messages).

## Rotate keys (env provider)

Rotation is graceful because old keys stay available for decryption:

1. **Add** a new key alongside the old one and make it active:
   ```bash
   export CC_SECRET_KEYS="v1:OLD…==,v2:NEW…=="
   export CC_SECRET_ACTIVE_KEY=v2
   ```
   Roll this config out to **every** process (all roles). New secrets now encrypt
   under `v2`; existing `v1` ciphertext still decrypts.

2. **Re-encrypt existing secrets** so they move to `v2`. There is no bulk re-key
   command; trigger a write on each stored secret by updating it through the API
   (`PUT` the channel; delete and re-create the subscription). Until then, old
   rows remain readable via `v1`.

3. **Retire the old key** only after you are confident nothing is still encrypted
   under it. Drop `v1` from `CC_SECRET_KEYS`:
   ```bash
   export CC_SECRET_KEYS="v2:NEW…=="
   ```
   If any ciphertext still references `v1` after you remove it, decryption of that
   row fails (`unknown key id: v1`), so retire conservatively.

> **Never** remove a key id that produced ciphertext still in the database. The
> safe order is always: add new → make active → re-encrypt → wait → remove old.

## Operational implications

- **Key loss = data loss.** If you lose the key material that encrypted stored
  secrets, those secrets are unrecoverable. Back up `CC_SECRET_KEYS` (and the KMS
  root key) in your secret manager, not in the repo.
- **All roles need the keys.** The cipher is built before role selection, so even
  a scheduler-only process must have valid key vars.
- **Audit log never holds the secret.** The `notifications.target` column stores a
  one-way `sha256:` digest, and transport/error logs strip the URL, so logs and
  the audit trail are safe to ship to less-trusted systems. A flush-time decrypt
  failure dead-letters the batch (observable) rather than dropping it silently.
- **What's *not* encrypted:** email recipient addresses and Telegram chat ids
  are stored structurally (not treated as secrets); Slack, Discord, and webhook
  channel URLs, Telegram bot tokens, and subscription webhook URLs are encrypted.
  Receivers hold channel names only and carry no secrets at all.

## Next

- The full design and threat model: [security model](../explanation/security-model.md).
- Variable reference:
  [configuration → secret encryption](../reference/configuration.md#secret-encryption--required).
