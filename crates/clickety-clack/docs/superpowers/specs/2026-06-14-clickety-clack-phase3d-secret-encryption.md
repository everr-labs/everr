# Clickety-Clack Phase 3D — Secret Encryption-at-Rest — Design Spec

**Status:** Approved (2026-06-14)
**Predecessors:** Phase 3A (silences/inhibition), 3B (durability), 3C (scale & portability) — all merged to main.
**Context:** clickety-clack is a headless Rust alerting system on ClickHouse, part of a large multi-tenant observability SaaS. It stores customer-supplied third-party credentials (Slack/webhook URLs, PagerDuty routing keys) and must not persist them in cleartext.

---

## Problem

All channel/receiver secrets are currently stored **cleartext** and reachable by anyone with read access to the data stores:

1. **Postgres `receivers.channel` (JSONB)** — the full `ChannelConfig` is serialized verbatim, secrets included. Only the *API response* is redacted (`ChannelConfig::redacted()`); the row at rest is cleartext.
2. **Redis `GroupMeta.target`** — Phase 2c resolves the channel target (the secret) at buffer time and stores it cleartext in the Redis group hash so the flusher can deliver later.

For a multi-tenant SaaS holding other tenants' credentials, a single read of either store (leaked backup/snapshot, read replica, read-only SQL injection, ops browsing, Redis access) hands over every tenant's secrets. Storage-layer (disk) encryption does **not** address this — it only protects stolen media, not query/read access. Phase 3D closes the query-access threat by encrypting secrets at the application boundary before they touch either store.

**Out of scope (unchanged):** app-compromise threats (a running process must hold the key to send notifications), in-flight TLS (already handled by the HTTP/SMTP clients), and process-level config secrets (`CC_CH_PASSWORD`, `CC_SMTP_PASSWORD`) which live in env/memory, not at rest.

---

## Locked decisions

| Decision | Choice |
|---|---|
| Key management | A `SecretCipher` trait seam with **two selectable implementations** chosen by `CC_SECRET_PROVIDER`: `env` keyring (real, production) and `kms` (in-process fake exercising the envelope path). Real cloud KMS deferred — drops into the same trait later. |
| Encryption granularity | **Per-secret structural envelope**: keep the `ChannelConfig` type discriminant cleartext, encrypt only secret field values. |
| Redis GroupMeta leak | **Encrypt the target in `GroupMeta`** at buffer time, decrypt at flush — preserves 2c snapshot-at-buffer semantics. |
| Migration / legacy | **None.** Greenfield (not deployed). Strict encrypted-only reads, fail-closed when no key is configured. No tolerant-read, no backfill. |
| KMS depth | Abstract trait + **fake KMS** impl, **unit-tested** against the in-process envelope. No cloud SDK dependency yet. |
| Cipher | AES-256-GCM (`aes-gcm` crate), random 96-bit nonces (`OsRng`), GCM auth tag for tamper detection. |

---

## Architecture

### New crate: `crates/crypto` (`cc-crypto`)

The single encryption boundary. Depends on `cc-domain` (for the `ChannelConfig` field mapping). Depended on by `cc-stores` and `cc-dispatcher`. No dependency cycle (`cc-domain` depends on neither).

```rust
pub trait SecretCipher: Send + Sync {
    fn encrypt(&self, plaintext: &[u8]) -> Result<Envelope, CryptoError>;
    fn decrypt(&self, env: &Envelope) -> Result<Vec<u8>, CryptoError>;
}

pub struct Envelope {
    pub key_id: String,                 // env: which static key; kms: root-key id
    pub nonce: Vec<u8>,                 // 12 bytes (payload nonce)
    pub ciphertext: Vec<u8>,            // AES-256-GCM(payload)
    pub wrapped_dek: Option<Vec<u8>>,   // None for env keyring; Some(wrap_nonce||wrap_ct) for KMS
}

#[derive(thiserror::Error, Debug)]
pub enum CryptoError { /* Decrypt, UnknownKeyId, Config, Encode, ... */ }
```

**Wire format.** `Envelope` serializes to a compact JSON object with base64url fields:
`{"kid":"v2","n":"<b64>","ct":"<b64>","dek":"<b64>"?}` (`dek` omitted when `None`). A `v` version tag (`"v":1`) is included for forward-compat. Helpers:

```rust
pub fn envelope_to_value(e: &Envelope) -> serde_json::Value;
pub fn envelope_from_value(v: &serde_json::Value) -> Result<Envelope, CryptoError>;
// String helpers for the Redis target (envelope packed into one compact string):
pub fn encrypt_str(c: &dyn SecretCipher, s: &str) -> Result<String, CryptoError>;
pub fn decrypt_str(c: &dyn SecretCipher, s: &str) -> Result<String, CryptoError>;
```

### Implementations

**`EnvKeyring` (`CC_SECRET_PROVIDER=env`, default) — production cipher.**
- Holds `keys: HashMap<String,[u8;32]>` + `active: String`.
- `encrypt`: AES-256-GCM with the active key + random nonce; `key_id = active`, `wrapped_dek = None`.
- `decrypt`: look up `env.key_id`; unknown id → `CryptoError::UnknownKeyId`.
- **Rotation works**: old ciphertexts carry their `key_id` and still decrypt after the active key changes. Rotate by adding a new key and flipping `CC_SECRET_ACTIVE_KEY`; an optional future re-encrypt sweep is out of scope for 3D.
- Constructed from `CC_SECRET_KEYS=v1:<b64-32B>,v2:<b64-32B>` and `CC_SECRET_ACTIVE_KEY=v2`. Construction fails (fail-closed) if the var is missing/empty, a key isn't 32 bytes, or `active` isn't present in the map.

**`FakeKms` (`CC_SECRET_PROVIDER=kms`) — envelope-path proof.**
- Holds an in-process `root: [u8;32]` from `CC_KMS_FAKE_ROOT_KEY` (b64-32B).
- `encrypt`: generate a random 32-byte DEK; AES-256-GCM the payload with the DEK (`nonce` = payload nonce); "wrap" the DEK by AES-256-GCM-encrypting it under `root` with its own nonce; `wrapped_dek = Some(wrap_nonce || wrap_ciphertext)`; `key_id = "fake-kms-root"`.
- `decrypt`: split `wrapped_dek` into wrap-nonce + ciphertext, unwrap the DEK under `root`, then decrypt the payload with the DEK + `env.nonce`.
- This is exactly the AWS-KMS `GenerateDataKey`/`Decrypt` envelope shape; a real KMS impl changes only *how the DEK is produced/unwrapped*, not the trait or any call site.

### Structural channel encryption

`ChannelConfig` (cc-domain) stays **cleartext in memory** — dispatcher, notifiers, and `redacted()` are unchanged. Encryption is a transform applied only at the storage boundary, centralized in `cc-crypto` so the "which fields are secret" knowledge lives in one place:

```rust
pub fn encrypt_channel(c: &dyn SecretCipher, ch: &ChannelConfig) -> Result<serde_json::Value, CryptoError>;
pub fn decrypt_channel(c: &dyn SecretCipher, v: &serde_json::Value) -> Result<ChannelConfig, CryptoError>;
```

Secret fields per variant:

| Variant | Encrypted | Cleartext |
|---|---|---|
| `Webhook { url }` | `url` | — |
| `Slack { url }` | `url` | — |
| `Pagerduty { routing_key }` | `routing_key` | — |
| `Email { to }` | — | `to` (recipient list, not a secret) |

Encrypted form keeps the discriminant queryable, e.g.:
```json
{"type":"slack","url":{"v":1,"kid":"v2","n":"…","ct":"…"}}
```
`decrypt_channel` reads `type`, then expects an envelope object at each secret field and a cleartext scalar at non-secret fields. **No DB migration** — `receivers.channel` is already `JSONB`; only the JSON *shape* changes, and there is no legacy data.

### Redis GroupMeta leak

`cc-queue` stays backend-agnostic: `GroupMeta.target` remains an opaque `String`. The dispatcher:
- **buffer time** (`grouping.rs`): `encrypt_str(cipher, &target)` before storing into `GroupMeta`.
- **flush time** (`run_group_flusher`): `decrypt_str(cipher, &meta.target)` before handing to the notifier.

Immediate routed delivery and the no-routes subscription firehose hold the target in memory only (never persisted), so they need no change beyond reading already-decrypted receivers.

### Wiring & fail-closed

- **`cc-stores`** (`pg.rs`): the three receiver methods gain a `&dyn SecretCipher` parameter (explicit dependency, avoids `PgStore::connect` signature churn that would ripple through every test):
  - `create_receiver(cipher, tenant, name, channel)` → `encrypt_channel` → JSONB.
  - `get_receiver(cipher, tenant, name)` → `decrypt_channel`.
  - `list_receivers(cipher, tenant)` → `decrypt_channel` each.
- **`cc-api`**: `AppState` gains `cipher: Arc<dyn SecretCipher>`; the receivers handlers pass it to the store. API redaction is unchanged (operates on cleartext `ChannelConfig`).
- **`cc-dispatcher`**: `run_dispatcher` and `run_group_flusher` gain `cipher: Arc<dyn SecretCipher>`; `process_event` reads receivers via the cipher; grouping encrypts/decrypts the target as above.
- **`src/main.rs`**: build the provider from config **once at startup**, before spawning roles. Construction returns `Result`; any failure (missing/invalid keys) propagates and the process exits → **fail-closed globally** (api and dispatcher both require the cipher).
- **Audit**: confirm `notification_log` and dead-letter rows record channel *type* + event payload, never the cleartext target. Redact if any cleartext secret is found persisted there.

### Config additions (`src/config.rs`)

| Env var | Meaning | Required |
|---|---|---|
| `CC_SECRET_PROVIDER` | `env` (default) or `kms` | no |
| `CC_SECRET_KEYS` | `id:<b64-32B>` comma list (env provider) | yes when `env` |
| `CC_SECRET_ACTIVE_KEY` | active key id (env provider) | yes when `env` |
| `CC_KMS_FAKE_ROOT_KEY` | b64-32B root key (kms provider) | yes when `kms` |

`cc-crypto` exposes a factory taking explicit, already-parsed params (it must **not** depend on the binary crate's `Config`):

```rust
pub enum ProviderKind { Env, Kms }
pub fn build_cipher(
    kind: ProviderKind,
    secret_keys: Option<&str>,        // raw CC_SECRET_KEYS for env
    active_key: Option<&str>,         // CC_SECRET_ACTIVE_KEY for env
    kms_fake_root_key: Option<&str>,  // CC_KMS_FAKE_ROOT_KEY for kms
) -> Result<Arc<dyn SecretCipher>, CryptoError>;
```

`src/config.rs` parses the env vars into typed fields; `src/main.rs` calls `build_cipher` with them and propagates the `Result` (fail-closed).

### Crate dependencies

`cc-crypto`: `aes-gcm = "0.10"`, `base64`, `serde`/`serde_json`, `thiserror`, `cc-domain` (workspace). Nonces via `aes_gcm::aead::OsRng`. `cc-stores` and `cc-dispatcher` add `cc-crypto` (workspace dep).

---

## Testing

**`cc-crypto` unit tests:**
- Env keyring: encrypt→decrypt round-trip; rotation (encrypt under `v2`, still decrypt a `v1`-tagged envelope); wrong/unknown `key_id` → error; tamper (flip a ciphertext byte) → GCM auth failure.
- Fake KMS: wrap/unwrap envelope round-trip; tamper on payload and on `wrapped_dek` both fail.
- `encrypt_channel`/`decrypt_channel` for every variant; `Email.to` stays cleartext; discriminant preserved; decrypt of a tampered envelope fails.
- `encrypt_str`/`decrypt_str` round-trip.
- Provider factory: `env` and `kms` happy paths; **fail-closed** on missing keys, malformed key, or `active` not in keyring.

**`cc-stores` integration test** (testcontainers Postgres): create a receiver with a known secret, then **raw-SQL read `receivers.channel` and assert the secret substring is absent** (the real at-rest proof); `get_receiver`/`list_receivers` round-trip back to the exact cleartext.

**`cc-dispatcher` test:** buffer a routed event into a group, **raw-read the Redis `GroupMeta` and assert the target is not cleartext**; run the flusher and assert it decrypts and delivers the correct target to the notifier double.

**e2e:** rewire `e2e_dispatch` and `e2e_grouping` (and any other receiver-touching e2e) with a real `EnvKeyring` test cipher; full `cargo test --workspace --no-fail-fast` green; `cargo clippy --all-targets -- -D warnings` clean; `cargo fmt --all -- --check` clean.

---

## Non-goals / future

- Real cloud KMS client (AWS/GCP/Vault) — deferred; the `SecretCipher` trait + `wrapped_dek` envelope already accommodate it with no call-site changes.
- Re-encryption sweep on key rotation — not needed pre-deploy; old `key_id`-tagged ciphertexts decrypt fine. Add later alongside KMS.
- Encrypting non-secret metadata, in-flight encryption, or app-compromise hardening.
- Redis pub/sub cache invalidation (still deferred from 3A, independent of this phase).
