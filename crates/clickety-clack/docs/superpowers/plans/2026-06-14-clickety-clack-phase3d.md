# Clickety-Clack Phase 3D — Secret Encryption-at-Rest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No customer-supplied delivery secret (Slack/webhook URLs, PagerDuty routing keys, subscription webhook URLs) is ever persisted in cleartext — not in Postgres (`receivers.channel`, `subscriptions.webhook_url`, `notifications.target`) nor in Redis (`GroupMeta.target`).

**Architecture:** A new `cc-crypto` crate owns a `SecretCipher` trait (AES-256-GCM) with two config-selectable implementations: `EnvKeyring` (production, versioned static keys, rotation-capable) and `FakeKms` (in-process envelope-encryption fake proving the wrap-a-data-key path so a real cloud KMS drops in later). Encryption is applied at the storage boundary: the store encrypts/decrypts `ChannelConfig` secret fields and subscription URLs; the dispatcher encrypts the channel target before buffering it into Redis and decrypts at flush; the notification audit log stores a non-reversible redacted digest of the target instead of the secret. Greenfield — strict encrypted-only reads, fail-closed when no key is configured, no legacy/backfill paths, no DB migration (column types already accommodate the new shapes).

**Tech Stack:** Rust 2021 workspace, `aes-gcm` 0.10, `base64` 0.22, `serde_json`, `sqlx`/Postgres, `redis`, testcontainers (Postgres + Redis).

**Spec:** `docs/superpowers/specs/2026-06-14-clickety-clack-phase3d-secret-encryption.md` (committed `bffa352`). Branch `feat/phase3d-secret-encryption`, base `main`.

**Conventions (every task):**
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit.
- Gate per task: `cargo test -p <crate> --no-run` must compile; relevant tests pass; `cargo clippy --all-targets -- -D warnings` clean; `cargo fmt --all` applied. **Before committing, run `cargo fmt --all` AND `git status` — stage every file fmt touched and any `Cargo.lock` changes** (a recurring miss in prior phases).
- Disambiguate the binary package as `-p cc@0.1.0` when needed.
- **No Claude / AI / Anthropic attribution anywhere** — not in commit messages, comments, or docs. No `Co-Authored-By`. No "Generated with" footers.
- Integration tests are Docker-backed (testcontainers). They are named `*_it.rs` (crate `tests/`) or live in the workspace-root `tests/` for e2e.

**Shared test-cipher snippet** (used by every test that needs a cipher — copy verbatim):
```rust
use cc_crypto::{EnvKeyring, SecretCipher};
use std::collections::HashMap;
use std::sync::Arc;

fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(
        EnvKeyring::new(HashMap::from([("v1".to_string(), [7u8; 32])]), "v1".to_string()).unwrap(),
    )
}
```

---

## File Structure

**New:**
- `crates/crypto/Cargo.toml`, `crates/crypto/src/lib.rs` — the `cc-crypto` crate: `SecretCipher`, `Envelope`, `CryptoError`, AEAD helpers, envelope wire codec, `EnvKeyring`, `FakeKms`, `encrypt_channel`/`decrypt_channel`, `encrypt_str`/`decrypt_str`, `ProviderKind`/`build_cipher`.
- `crates/stores/tests/secret_at_rest_it.rs` — raw-SQL proof that receivers + subscriptions store no cleartext.
- `crates/dispatcher/tests/group_secret_it.rs` — raw-Redis proof that `GroupMeta.target` is encrypted, plus decrypt round-trip.

**Modified:**
- `Cargo.toml` (root) — add `crates/crypto` to workspace members and `cc-crypto` to the bin's `[dependencies]`.
- `crates/stores/Cargo.toml`, `crates/stores/src/pg.rs` — `StoreError::Crypto`; cipher params on receiver + subscription methods.
- `crates/api/Cargo.toml`, `crates/api/src/lib.rs`, `crates/api/src/receivers.rs`, `crates/api/src/subscriptions.rs` — `AppState.cipher`; thread cipher to store calls.
- `crates/dispatcher/Cargo.toml`, `crates/dispatcher/src/lib.rs`, `crates/dispatcher/src/dedup.rs` — cipher on `run_dispatcher`/`run_group_flusher`/`process_event`/`firehose_deliver`/`flush_group`; encrypt target at buffer, decrypt at flush; `redact_target` for audit log + dead-letter logs.
- `src/config.rs`, `src/main.rs` — config fields + fail-closed cipher construction and injection.
- Test call sites: `crates/stores/tests/routing_it.rs`, `crates/dispatcher/tests/routing_dispatch_it.rs`, `crates/dispatcher/tests/dispatch_it.rs`, `tests/e2e_dispatch.rs`, `tests/e2e_grouping.rs`, `tests/e2e_routing.rs`, `tests/e2e_durability.rs`, `tests/e2e_silences_inhibition.rs`, `tests/e2e_reconcile_silence.rs`, and any `crates/api/tests/*` building `AppState`.

---

## Task 1: `cc-crypto` crate — trait, envelope, AEAD helpers, wire codec

**Files:**
- Create: `crates/crypto/Cargo.toml`
- Create: `crates/crypto/src/lib.rs`
- Modify: `Cargo.toml` (root) — workspace members

- [ ] **Step 1: Add the crate to the workspace and create its manifest**

In `Cargo.toml` (root), add `"crates/crypto"` to the `members` array (end of the list).

Create `crates/crypto/Cargo.toml`:
```toml
[package]
name = "cc-crypto"
version = "0.1.0"
edition.workspace = true

[dependencies]
aes-gcm = "0.10"
base64 = "0.22"
serde_json.workspace = true
thiserror.workspace = true
cc-domain = { path = "../domain" }
```

- [ ] **Step 2: Write the failing test** (create `crates/crypto/src/lib.rs` with only the test module at the bottom and empty/`todo!` items will not compile — instead write the real types in Step 3; for TDD, first add this test and the minimal type stubs needed to compile, then implement). Put this at the bottom of `crates/crypto/src/lib.rs`:

```rust
#[cfg(test)]
mod wire_tests {
    use super::*;

    #[test]
    fn envelope_value_round_trips() {
        let e = Envelope {
            key_id: "v2".into(),
            nonce: vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            ciphertext: vec![9, 8, 7],
            wrapped_dek: Some(vec![4, 5, 6]),
        };
        let v = envelope_to_value(&e);
        assert_eq!(v["v"], 1);
        assert_eq!(v["kid"], "v2");
        let back = envelope_from_value(&v).unwrap();
        assert_eq!(back, e);
    }

    #[test]
    fn envelope_without_dek_omits_field() {
        let e = Envelope {
            key_id: "v1".into(),
            nonce: vec![0; 12],
            ciphertext: vec![1],
            wrapped_dek: None,
        };
        let v = envelope_to_value(&e);
        assert!(v.get("dek").is_none());
        assert_eq!(envelope_from_value(&v).unwrap(), e);
    }

    #[test]
    fn envelope_from_value_rejects_garbage() {
        let v = serde_json::json!({"kid":"v1","n":"!!!notb64","ct":"AA"});
        assert!(envelope_from_value(&v).is_err());
    }
}
```

- [ ] **Step 3: Implement the trait, error, envelope, AEAD helpers, and wire codec**

Put this at the TOP of `crates/crypto/src/lib.rs` (above the test module):

```rust
//! Application-level secret encryption (AES-256-GCM) for clickety-clack.
//!
//! A [`SecretCipher`] turns plaintext into a self-describing [`Envelope`] and back.
//! Two implementations are selected by config: [`EnvKeyring`] (versioned static keys)
//! and [`FakeKms`] (in-process envelope encryption proving the data-key-wrap path so a
//! real cloud KMS can be added later behind the same trait).

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(thiserror::Error, Debug)]
pub enum CryptoError {
    #[error("decryption failed")]
    Decrypt,
    #[error("encryption failed")]
    Encrypt,
    #[error("unknown key id: {0}")]
    UnknownKeyId(String),
    #[error("config: {0}")]
    Config(String),
    #[error("malformed envelope: {0}")]
    Envelope(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

/// A self-describing ciphertext. `key_id` selects the key (env keyring) or names the
/// root key (KMS). `wrapped_dek` is `None` for direct-key ciphers and `Some` for the
/// envelope (KMS) scheme, carrying the data key encrypted under the root key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    pub key_id: String,
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
    pub wrapped_dek: Option<Vec<u8>>,
}

/// Encrypts/decrypts opaque byte strings. Implementations must be safe to share.
pub trait SecretCipher: Send + Sync {
    fn encrypt(&self, plaintext: &[u8]) -> Result<Envelope, CryptoError>;
    fn decrypt(&self, env: &Envelope) -> Result<Vec<u8>, CryptoError>;
}

// --- internal AES-256-GCM helpers (random 96-bit nonce per call) ---

pub(crate) fn aead_encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher.encrypt(&nonce, plaintext).map_err(|_| CryptoError::Encrypt)?;
    Ok((nonce.to_vec(), ct))
}

pub(crate) fn aead_decrypt(key: &[u8; 32], nonce: &[u8], ct: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if nonce.len() != 12 {
        return Err(CryptoError::Decrypt);
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| CryptoError::Decrypt)
}

// --- envelope wire codec (base64 fields, version tag) ---

pub fn envelope_to_value(e: &Envelope) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("v".into(), json!(1));
    m.insert("kid".into(), json!(e.key_id));
    m.insert("n".into(), json!(STANDARD.encode(&e.nonce)));
    m.insert("ct".into(), json!(STANDARD.encode(&e.ciphertext)));
    if let Some(d) = &e.wrapped_dek {
        m.insert("dek".into(), json!(STANDARD.encode(d)));
    }
    Value::Object(m)
}

pub fn envelope_from_value(v: &Value) -> Result<Envelope, CryptoError> {
    let obj = v
        .as_object()
        .ok_or_else(|| CryptoError::Envelope("not a JSON object".into()))?;
    let get_str = |k: &str| -> Result<String, CryptoError> {
        obj.get(k)
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| CryptoError::Envelope(format!("missing string field '{k}'")))
    };
    let dec = |k: &str| -> Result<Vec<u8>, CryptoError> {
        STANDARD
            .decode(get_str(k)?)
            .map_err(|_| CryptoError::Envelope(format!("field '{k}' is not valid base64")))
    };
    let key_id = get_str("kid")?;
    let nonce = dec("n")?;
    let ciphertext = dec("ct")?;
    let wrapped_dek = match obj.get("dek") {
        Some(d) => {
            let s = d
                .as_str()
                .ok_or_else(|| CryptoError::Envelope("'dek' not a string".into()))?;
            Some(
                STANDARD
                    .decode(s)
                    .map_err(|_| CryptoError::Envelope("'dek' is not valid base64".into()))?,
            )
        }
        None => None,
    };
    Ok(Envelope { key_id, nonce, ciphertext, wrapped_dek })
}
```

Note: `HashMap`, `Arc`, and `cc_domain` imports are used by later tasks in this same file; if clippy flags them as unused after Task 1, leave them — Tasks 2–4 consume them. (If you prefer a clean intermediate clippy run, add them in the task that first uses them. Either way the final state imports all of them.)

- [ ] **Step 4: Run the tests**

Run: `cargo test -p cc-crypto wire_tests`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add Cargo.toml Cargo.lock crates/crypto/Cargo.toml crates/crypto/src/lib.rs
git commit -m "Add cc-crypto crate: SecretCipher trait, Envelope, AEAD + wire codec"
```

---

## Task 2: `EnvKeyring` — production cipher with rotation

**Files:**
- Modify: `crates/crypto/src/lib.rs`

- [ ] **Step 1: Write the failing tests** — append to `crates/crypto/src/lib.rs`:

```rust
#[cfg(test)]
mod env_keyring_tests {
    use super::*;

    fn keyring() -> EnvKeyring {
        EnvKeyring::new(
            HashMap::from([("v1".to_string(), [1u8; 32]), ("v2".to_string(), [2u8; 32])]),
            "v2".to_string(),
        )
        .unwrap()
    }

    #[test]
    fn round_trip_uses_active_key() {
        let k = keyring();
        let env = k.encrypt(b"super-secret").unwrap();
        assert_eq!(env.key_id, "v2");
        assert!(env.wrapped_dek.is_none());
        assert_eq!(k.decrypt(&env).unwrap(), b"super-secret");
    }

    #[test]
    fn ciphertext_is_not_plaintext() {
        let env = keyring().encrypt(b"hooks.slack/abc").unwrap();
        assert_ne!(env.ciphertext, b"hooks.slack/abc");
    }

    #[test]
    fn decrypts_old_key_after_rotation() {
        // Encrypt under a keyring whose active key is v1...
        let old = EnvKeyring::new(HashMap::from([("v1".to_string(), [1u8; 32])]), "v1".to_string()).unwrap();
        let env = old.encrypt(b"legacy").unwrap();
        assert_eq!(env.key_id, "v1");
        // ...a rotated keyring (active v2, still holds v1) decrypts it.
        assert_eq!(keyring().decrypt(&env).unwrap(), b"legacy");
    }

    #[test]
    fn unknown_key_id_errors() {
        let env = Envelope { key_id: "v9".into(), nonce: vec![0; 12], ciphertext: vec![1], wrapped_dek: None };
        assert!(matches!(keyring().decrypt(&env), Err(CryptoError::UnknownKeyId(_))));
    }

    #[test]
    fn tampered_ciphertext_fails_auth() {
        let k = keyring();
        let mut env = k.encrypt(b"data").unwrap();
        env.ciphertext[0] ^= 0xFF;
        assert!(matches!(k.decrypt(&env), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn new_rejects_missing_active() {
        let e = EnvKeyring::new(HashMap::from([("v1".to_string(), [1u8; 32])]), "v2".to_string());
        assert!(e.is_err());
    }

    #[test]
    fn from_spec_parses_and_validates() {
        let k32 = STANDARD.encode([3u8; 32]);
        let spec = format!("a:{k32}, b:{k32}");
        let k = EnvKeyring::from_spec(&spec, "b").unwrap();
        let env = k.encrypt(b"x").unwrap();
        assert_eq!(env.key_id, "b");
        assert_eq!(k.decrypt(&env).unwrap(), b"x");

        assert!(EnvKeyring::from_spec("", "a").is_err()); // no keys
        assert!(EnvKeyring::from_spec(&format!("a:{k32}"), "z").is_err()); // active absent
        assert!(EnvKeyring::from_spec("a:not-base64", "a").is_err()); // bad b64
        let short = STANDARD.encode([0u8; 16]);
        assert!(EnvKeyring::from_spec(&format!("a:{short}"), "a").is_err()); // wrong length
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p cc-crypto env_keyring_tests`
Expected: FAIL to compile (`EnvKeyring` not found).

- [ ] **Step 3: Implement `EnvKeyring`** — append to `crates/crypto/src/lib.rs` (above the test modules):

```rust
/// Production cipher: a set of versioned 32-byte keys with one active key. Ciphertexts
/// carry their `key_id`, so rotating the active key leaves older ciphertexts decryptable.
pub struct EnvKeyring {
    keys: HashMap<String, [u8; 32]>,
    active: String,
}

impl EnvKeyring {
    /// Build from an in-memory key map. Errors if empty or `active` is absent.
    pub fn new(keys: HashMap<String, [u8; 32]>, active: String) -> Result<Self, CryptoError> {
        if keys.is_empty() {
            return Err(CryptoError::Config("no keys configured".into()));
        }
        if !keys.contains_key(&active) {
            return Err(CryptoError::Config(format!("active key '{active}' not in keyring")));
        }
        Ok(Self { keys, active })
    }

    /// Parse `id:<base64-32B>,id2:<base64-32B>` and the active id from raw env strings.
    pub fn from_spec(keys_spec: &str, active: &str) -> Result<Self, CryptoError> {
        let mut keys = HashMap::new();
        for part in keys_spec.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let (id, b64) = part
                .split_once(':')
                .ok_or_else(|| CryptoError::Config(format!("key entry missing ':' => {part}")))?;
            let raw = STANDARD
                .decode(b64.trim())
                .map_err(|_| CryptoError::Config(format!("key '{id}' is not valid base64")))?;
            let arr: [u8; 32] = raw.as_slice().try_into().map_err(|_| {
                CryptoError::Config(format!("key '{id}' must be 32 bytes, got {}", raw.len()))
            })?;
            keys.insert(id.trim().to_string(), arr);
        }
        Self::new(keys, active.to_string())
    }
}

impl SecretCipher for EnvKeyring {
    fn encrypt(&self, plaintext: &[u8]) -> Result<Envelope, CryptoError> {
        let key = self
            .keys
            .get(&self.active)
            .ok_or_else(|| CryptoError::UnknownKeyId(self.active.clone()))?;
        let (nonce, ciphertext) = aead_encrypt(key, plaintext)?;
        Ok(Envelope { key_id: self.active.clone(), nonce, ciphertext, wrapped_dek: None })
    }

    fn decrypt(&self, env: &Envelope) -> Result<Vec<u8>, CryptoError> {
        let key = self
            .keys
            .get(&env.key_id)
            .ok_or_else(|| CryptoError::UnknownKeyId(env.key_id.clone()))?;
        aead_decrypt(key, &env.nonce, &env.ciphertext)
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p cc-crypto env_keyring_tests`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/crypto/src/lib.rs
git commit -m "Add EnvKeyring cipher with versioned keys and rotation"
```

---

## Task 3: `FakeKms` — envelope-encryption fake (data-key wrap/unwrap)

**Files:**
- Modify: `crates/crypto/src/lib.rs`

- [ ] **Step 1: Write the failing tests** — append to `crates/crypto/src/lib.rs`:

```rust
#[cfg(test)]
mod fake_kms_tests {
    use super::*;

    fn kms() -> FakeKms {
        FakeKms::new([5u8; 32])
    }

    #[test]
    fn round_trip_via_wrapped_dek() {
        let k = kms();
        let env = k.encrypt(b"routing-key-123").unwrap();
        assert_eq!(env.key_id, "fake-kms-root");
        assert!(env.wrapped_dek.is_some());
        assert_ne!(env.ciphertext, b"routing-key-123");
        assert_eq!(k.decrypt(&env).unwrap(), b"routing-key-123");
    }

    #[test]
    fn tampered_payload_fails() {
        let k = kms();
        let mut env = k.encrypt(b"x").unwrap();
        env.ciphertext[0] ^= 0xFF;
        assert!(k.decrypt(&env).is_err());
    }

    #[test]
    fn tampered_wrapped_dek_fails() {
        let k = kms();
        let mut env = k.encrypt(b"x").unwrap();
        let d = env.wrapped_dek.as_mut().unwrap();
        let last = d.len() - 1;
        d[last] ^= 0xFF;
        assert!(k.decrypt(&env).is_err());
    }

    #[test]
    fn missing_wrapped_dek_errors() {
        let env = Envelope { key_id: "fake-kms-root".into(), nonce: vec![0; 12], ciphertext: vec![1], wrapped_dek: None };
        assert!(matches!(kms().decrypt(&env), Err(CryptoError::Envelope(_))));
    }

    #[test]
    fn from_b64_validates_length() {
        let ok = STANDARD.encode([0u8; 32]);
        assert!(FakeKms::from_b64(&ok).is_ok());
        assert!(FakeKms::from_b64("not-base64").is_err());
        assert!(FakeKms::from_b64(&STANDARD.encode([0u8; 16])).is_err());
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p cc-crypto fake_kms_tests`
Expected: FAIL to compile (`FakeKms` not found).

- [ ] **Step 3: Implement `FakeKms`** — append to `crates/crypto/src/lib.rs` (above the test modules). Add the `RngCore` import to the existing `use aes_gcm::aead::{...}` line so it reads `use aes_gcm::aead::{rand_core::RngCore, Aead, AeadCore, KeyInit, OsRng};`:

```rust
const FAKE_KMS_KEY_ID: &str = "fake-kms-root";

/// In-process stand-in for a cloud KMS. Each `encrypt` generates a fresh data key (DEK),
/// encrypts the payload under the DEK, then wraps the DEK under the root key — exactly the
/// shape of AWS KMS GenerateDataKey/Decrypt. A real KMS impl swaps only DEK wrap/unwrap.
pub struct FakeKms {
    root: [u8; 32],
}

impl FakeKms {
    pub fn new(root: [u8; 32]) -> Self {
        Self { root }
    }

    pub fn from_b64(root_b64: &str) -> Result<Self, CryptoError> {
        let raw = STANDARD
            .decode(root_b64.trim())
            .map_err(|_| CryptoError::Config("CC_KMS_FAKE_ROOT_KEY is not valid base64".into()))?;
        let root: [u8; 32] = raw.as_slice().try_into().map_err(|_| {
            CryptoError::Config(format!("root key must be 32 bytes, got {}", raw.len()))
        })?;
        Ok(Self { root })
    }
}

impl SecretCipher for FakeKms {
    fn encrypt(&self, plaintext: &[u8]) -> Result<Envelope, CryptoError> {
        let mut dek = [0u8; 32];
        OsRng.fill_bytes(&mut dek);
        let (nonce, ciphertext) = aead_encrypt(&dek, plaintext)?;
        let (wrap_nonce, wrap_ct) = aead_encrypt(&self.root, &dek)?;
        let mut wrapped = Vec::with_capacity(wrap_nonce.len() + wrap_ct.len());
        wrapped.extend_from_slice(&wrap_nonce);
        wrapped.extend_from_slice(&wrap_ct);
        Ok(Envelope { key_id: FAKE_KMS_KEY_ID.into(), nonce, ciphertext, wrapped_dek: Some(wrapped) })
    }

    fn decrypt(&self, env: &Envelope) -> Result<Vec<u8>, CryptoError> {
        let wrapped = env
            .wrapped_dek
            .as_ref()
            .ok_or_else(|| CryptoError::Envelope("kms envelope missing wrapped_dek".into()))?;
        if wrapped.len() < 12 {
            return Err(CryptoError::Envelope("wrapped_dek too short".into()));
        }
        let (wrap_nonce, wrap_ct) = wrapped.split_at(12);
        let dek_vec = aead_decrypt(&self.root, wrap_nonce, wrap_ct)?;
        let dek: [u8; 32] = dek_vec
            .as_slice()
            .try_into()
            .map_err(|_| CryptoError::Envelope("unwrapped data key wrong size".into()))?;
        aead_decrypt(&dek, &env.nonce, &env.ciphertext)
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p cc-crypto fake_kms_tests`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/crypto/src/lib.rs
git commit -m "Add FakeKms envelope cipher proving the data-key wrap path"
```

---

## Task 4: Channel/string helpers + provider factory

**Files:**
- Modify: `crates/crypto/src/lib.rs`

- [ ] **Step 1: Write the failing tests** — append to `crates/crypto/src/lib.rs`:

```rust
#[cfg(test)]
mod helper_tests {
    use super::*;
    use cc_domain::receiver::ChannelConfig;

    fn cipher() -> EnvKeyring {
        EnvKeyring::new(HashMap::from([("v1".to_string(), [9u8; 32])]), "v1".to_string()).unwrap()
    }

    #[test]
    fn str_round_trip() {
        let c = cipher();
        let enc = encrypt_str(&c, "https://hooks.slack/SECRET").unwrap();
        assert!(!enc.contains("SECRET"));
        assert_eq!(decrypt_str(&c, &enc).unwrap(), "https://hooks.slack/SECRET");
    }

    #[test]
    fn channel_secret_fields_are_encrypted_and_recoverable() {
        let c = cipher();
        for ch in [
            ChannelConfig::Slack { url: "https://hooks.slack/SECRET".into() },
            ChannelConfig::Webhook { url: "https://wh/AUTH".into() },
            ChannelConfig::Pagerduty { routing_key: "PD-KEY".into() },
        ] {
            let v = encrypt_channel(&c, &ch).unwrap();
            let raw = serde_json::to_string(&v).unwrap();
            assert!(!raw.contains("SECRET") && !raw.contains("AUTH") && !raw.contains("PD-KEY"));
            assert_eq!(v["type"], ch.channel_name());
            assert_eq!(decrypt_channel(&c, &v).unwrap(), ch);
        }
    }

    #[test]
    fn email_recipients_stay_cleartext() {
        let c = cipher();
        let ch = ChannelConfig::Email { to: vec!["a@x.test".into(), "b@x.test".into()] };
        let v = encrypt_channel(&c, &ch).unwrap();
        assert_eq!(v["type"], "email");
        assert_eq!(v["to"][0], "a@x.test"); // not encrypted
        assert_eq!(decrypt_channel(&c, &v).unwrap(), ch);
    }

    #[test]
    fn decrypt_channel_rejects_unknown_type() {
        let v = serde_json::json!({"type":"carrier-pigeon"});
        assert!(decrypt_channel(&cipher(), &v).is_err());
    }

    #[test]
    fn build_cipher_env_happy_and_fail_closed() {
        let k32 = STANDARD.encode([4u8; 32]);
        let ok = build_cipher(ProviderKind::Env, Some(&format!("v1:{k32}")), Some("v1"), None);
        assert!(ok.is_ok());
        // fail-closed: missing keys
        assert!(build_cipher(ProviderKind::Env, None, Some("v1"), None).is_err());
        assert!(build_cipher(ProviderKind::Env, Some(&format!("v1:{k32}")), None, None).is_err());
    }

    #[test]
    fn build_cipher_kms_happy_and_fail_closed() {
        let root = STANDARD.encode([1u8; 32]);
        assert!(build_cipher(ProviderKind::Kms, None, None, Some(&root)).is_ok());
        assert!(build_cipher(ProviderKind::Kms, None, None, None).is_err());
    }

    #[test]
    fn provider_kind_parse() {
        assert!(matches!(ProviderKind::parse("env").unwrap(), ProviderKind::Env));
        assert!(matches!(ProviderKind::parse("kms").unwrap(), ProviderKind::Kms));
        assert!(ProviderKind::parse("nope").is_err());
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p cc-crypto helper_tests`
Expected: FAIL to compile (helpers/factory not found).

- [ ] **Step 3: Implement helpers + factory** — append to `crates/crypto/src/lib.rs` (above the test modules). Replace the placeholder `cc_domain` import note from Task 1 by adding this concrete import near the top imports: `use cc_domain::receiver::ChannelConfig;`

```rust
/// Encrypt a UTF-8 string into a compact JSON envelope string (used for the Redis
/// group target and any single-secret field).
pub fn encrypt_str(c: &dyn SecretCipher, s: &str) -> Result<String, CryptoError> {
    Ok(serde_json::to_string(&envelope_to_value(&c.encrypt(s.as_bytes())?))?)
}

pub fn decrypt_str(c: &dyn SecretCipher, s: &str) -> Result<String, CryptoError> {
    let env = envelope_from_value(&serde_json::from_str(s)?)?;
    String::from_utf8(c.decrypt(&env)?).map_err(|_| CryptoError::Decrypt)
}

/// Serialize a `ChannelConfig` with secret fields replaced by encryption envelopes.
/// The `type` discriminant and non-secret fields (email recipients) stay cleartext.
pub fn encrypt_channel(c: &dyn SecretCipher, ch: &ChannelConfig) -> Result<Value, CryptoError> {
    let enc = |s: &str| -> Result<Value, CryptoError> { Ok(envelope_to_value(&c.encrypt(s.as_bytes())?)) };
    Ok(match ch {
        ChannelConfig::Webhook { url } => json!({"type": "webhook", "url": enc(url)?}),
        ChannelConfig::Slack { url } => json!({"type": "slack", "url": enc(url)?}),
        ChannelConfig::Pagerduty { routing_key } => json!({"type": "pagerduty", "routing_key": enc(routing_key)?}),
        ChannelConfig::Email { to } => json!({"type": "email", "to": to}),
    })
}

/// Inverse of [`encrypt_channel`].
pub fn decrypt_channel(c: &dyn SecretCipher, v: &Value) -> Result<ChannelConfig, CryptoError> {
    let ty = v
        .get("type")
        .and_then(|x| x.as_str())
        .ok_or_else(|| CryptoError::Envelope("channel missing 'type'".into()))?;
    let dec = |field: &str| -> Result<String, CryptoError> {
        let fv = v
            .get(field)
            .ok_or_else(|| CryptoError::Envelope(format!("channel missing '{field}'")))?;
        String::from_utf8(c.decrypt(&envelope_from_value(fv)?)?).map_err(|_| CryptoError::Decrypt)
    };
    Ok(match ty {
        "webhook" => ChannelConfig::Webhook { url: dec("url")? },
        "slack" => ChannelConfig::Slack { url: dec("url")? },
        "pagerduty" => ChannelConfig::Pagerduty { routing_key: dec("routing_key")? },
        "email" => {
            let to_val = v
                .get("to")
                .cloned()
                .ok_or_else(|| CryptoError::Envelope("email channel missing 'to'".into()))?;
            ChannelConfig::Email { to: serde_json::from_value(to_val)? }
        }
        other => return Err(CryptoError::Envelope(format!("unknown channel type '{other}'"))),
    })
}

/// Which `SecretCipher` implementation to construct.
pub enum ProviderKind {
    Env,
    Kms,
}

impl ProviderKind {
    pub fn parse(s: &str) -> Result<ProviderKind, CryptoError> {
        match s {
            "env" => Ok(ProviderKind::Env),
            "kms" => Ok(ProviderKind::Kms),
            other => Err(CryptoError::Config(format!("unknown CC_SECRET_PROVIDER '{other}'"))),
        }
    }
}

/// Fail-closed factory: returns an error (so the process can exit) if required key
/// material for the selected provider is missing or invalid.
pub fn build_cipher(
    kind: ProviderKind,
    secret_keys: Option<&str>,
    active_key: Option<&str>,
    kms_fake_root_key: Option<&str>,
) -> Result<Arc<dyn SecretCipher>, CryptoError> {
    match kind {
        ProviderKind::Env => {
            let keys = secret_keys
                .ok_or_else(|| CryptoError::Config("CC_SECRET_KEYS required for env provider".into()))?;
            let active = active_key.ok_or_else(|| {
                CryptoError::Config("CC_SECRET_ACTIVE_KEY required for env provider".into())
            })?;
            Ok(Arc::new(EnvKeyring::from_spec(keys, active)?))
        }
        ProviderKind::Kms => {
            let root = kms_fake_root_key.ok_or_else(|| {
                CryptoError::Config("CC_KMS_FAKE_ROOT_KEY required for kms provider".into())
            })?;
            Ok(Arc::new(FakeKms::from_b64(root)?))
        }
    }
}
```

- [ ] **Step 4: Run the full crate test suite**

Run: `cargo test -p cc-crypto`
Expected: all modules pass (wire + env_keyring + fake_kms + helper).

- [ ] **Step 5: Clippy + commit**

Run: `cargo clippy -p cc-crypto --all-targets -- -D warnings`
Expected: clean.

```bash
cargo fmt --all
git add crates/crypto/src/lib.rs
git commit -m "Add channel/string crypto helpers and fail-closed provider factory"
```

---

## Task 5: `cc-stores` — encrypt receivers at rest

**Files:**
- Modify: `crates/stores/Cargo.toml`
- Modify: `crates/stores/src/pg.rs:17-25` (StoreError), `:430-501` (receiver methods)
- Modify: `crates/stores/tests/routing_it.rs`

- [ ] **Step 1: Add the dependency and error variant**

In `crates/stores/Cargo.toml` under `[dependencies]` add:
```toml
cc-crypto = { path = "../crypto" }
```

In `crates/stores/src/pg.rs`, extend `StoreError` (after the `Json` variant):
```rust
    #[error("crypto: {0}")]
    Crypto(#[from] cc_crypto::CryptoError),
```

Add this import near the top of `pg.rs` (with the other `cc_*` / `use` lines):
```rust
use cc_crypto::SecretCipher;
```

- [ ] **Step 2: Write the failing test** — append to `crates/stores/tests/routing_it.rs` a new test (and add the test-cipher helper + imports at the top if not present — see the shared snippet). First, update the EXISTING calls in this file to pass a cipher (so the file compiles): every `create_receiver`, `get_receiver`, `list_receivers` call gets `cipher.as_ref()` as the first argument, where `let cipher = test_cipher();` is created right after the store is built. Then add:

```rust
#[tokio::test]
async fn receiver_secret_not_stored_cleartext() {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    let cipher = test_cipher();
    let tenant = TenantId(Uuid::new_v4());

    store
        .create_receiver(
            cipher.as_ref(),
            tenant,
            "chat",
            &ChannelConfig::Slack { url: "https://hooks.slack/SECRET-TOKEN".into() },
        )
        .await
        .unwrap();

    // Raw column read: the secret must NOT appear in cleartext.
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let raw: String = sqlx::query_scalar("SELECT channel::text FROM receivers WHERE tenant=$1")
        .bind(tenant.0)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!raw.contains("SECRET-TOKEN"), "secret leaked at rest: {raw}");
    assert!(raw.contains("\"type\":\"slack\""), "discriminant should stay cleartext");

    // Round-trip back to cleartext via the store.
    let got = store.get_receiver(cipher.as_ref(), tenant, "chat").await.unwrap().unwrap();
    assert_eq!(got.channel, ChannelConfig::Slack { url: "https://hooks.slack/SECRET-TOKEN".into() });
}
```

The top of `crates/stores/tests/routing_it.rs` must import `sqlx` types it now uses; add `use cc_crypto::{EnvKeyring, SecretCipher};`, `use std::collections::HashMap;`, `use std::sync::Arc;`, and the `test_cipher()` fn from the shared snippet.

- [ ] **Step 3: Run to confirm failure**

Run: `cargo test -p cc-stores --test routing_it -- receiver_secret_not_stored_cleartext`
Expected: FAIL to compile (methods don't take a cipher yet).

- [ ] **Step 4: Implement** — replace the three receiver methods in `crates/stores/src/pg.rs`:

```rust
    pub async fn create_receiver(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
        name: &str,
        channel: &ChannelConfig,
    ) -> Result<Receiver, StoreError> {
        let id = Uuid::new_v4();
        let ch_json = cc_crypto::encrypt_channel(cipher, channel)?;
        let row = sqlx::query(
            "INSERT INTO receivers (id, tenant, name, channel) VALUES ($1,$2,$3,$4)
             ON CONFLICT (tenant, name) DO UPDATE SET channel = EXCLUDED.channel
             RETURNING id",
        )
        .bind(id)
        .bind(tenant.0)
        .bind(name)
        .bind(&ch_json)
        .fetch_one(&self.pool)
        .await?;
        Ok(Receiver {
            id: row.get("id"),
            tenant,
            name: name.to_string(),
            channel: channel.clone(),
        })
    }

    pub async fn get_receiver(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
        name: &str,
    ) -> Result<Option<Receiver>, StoreError> {
        let row = sqlx::query(
            "SELECT id, tenant, name, channel FROM receivers WHERE tenant=$1 AND name=$2",
        )
        .bind(tenant.0)
        .bind(name)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            None => Ok(None),
            Some(r) => {
                let v: serde_json::Value = r.get("channel");
                let channel = cc_crypto::decrypt_channel(cipher, &v)?;
                Ok(Some(Receiver {
                    id: r.get("id"),
                    tenant: TenantId(r.get("tenant")),
                    name: r.get("name"),
                    channel,
                }))
            }
        }
    }

    pub async fn list_receivers(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
    ) -> Result<Vec<Receiver>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, name, channel FROM receivers WHERE tenant=$1 ORDER BY name",
        )
        .bind(tenant.0)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::new();
        for r in &rows {
            let v: serde_json::Value = r.get("channel");
            let channel = cc_crypto::decrypt_channel(cipher, &v)?;
            out.push(Receiver {
                id: r.get("id"),
                tenant: TenantId(r.get("tenant")),
                name: r.get("name"),
                channel,
            });
        }
        Ok(out)
    }
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p cc-stores --test routing_it`
Expected: all pass (existing routing tests + new at-rest test).

- [ ] **Step 6: Commit**

```bash
cargo fmt --all
git add crates/stores/Cargo.toml crates/stores/src/pg.rs crates/stores/tests/routing_it.rs Cargo.lock
git commit -m "Encrypt receiver channel secrets at rest in Postgres"
```

---

## Task 6: `cc-stores` — encrypt subscription webhook URLs at rest

**Files:**
- Modify: `crates/stores/src/pg.rs:316-351` (subscription methods)
- Create: `crates/stores/tests/secret_at_rest_it.rs`

- [ ] **Step 1: Write the failing test** — create `crates/stores/tests/secret_at_rest_it.rs`:

```rust
use cc_crypto::{EnvKeyring, SecretCipher};
use cc_stores::PgStore;
use cc_domain::ids::TenantId;
use std::collections::HashMap;
use std::sync::Arc;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use uuid::Uuid;

fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(EnvKeyring::new(HashMap::from([("v1".to_string(), [7u8; 32])]), "v1".to_string()).unwrap())
}

#[tokio::test]
async fn subscription_url_not_stored_cleartext() {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    let cipher = test_cipher();
    let tenant = TenantId(Uuid::new_v4());

    store
        .create_subscription(cipher.as_ref(), tenant, "https://hook.test/SUB-SECRET")
        .await
        .unwrap();

    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let raw: String = sqlx::query_scalar("SELECT webhook_url FROM subscriptions WHERE tenant=$1")
        .bind(tenant.0)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!raw.contains("SUB-SECRET"), "subscription url leaked at rest: {raw}");

    let subs = store.subscriptions_for(cipher.as_ref(), tenant).await.unwrap();
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0].webhook_url, "https://hook.test/SUB-SECRET");
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p cc-stores --test secret_at_rest_it`
Expected: FAIL to compile (subscription methods don't take a cipher yet).

- [ ] **Step 3: Implement** — replace the two subscription methods in `crates/stores/src/pg.rs`:

```rust
    pub async fn create_subscription(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
        url: &str,
    ) -> Result<Subscription, StoreError> {
        let id = Uuid::new_v4();
        let enc = cc_crypto::encrypt_str(cipher, url)?;
        sqlx::query("INSERT INTO subscriptions (id, tenant, webhook_url) VALUES ($1,$2,$3)")
            .bind(id)
            .bind(tenant.0)
            .bind(&enc)
            .execute(&self.pool)
            .await?;
        Ok(Subscription {
            id,
            tenant,
            webhook_url: url.to_string(),
        })
    }

    pub async fn subscriptions_for(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
    ) -> Result<Vec<Subscription>, StoreError> {
        let rows = sqlx::query("SELECT id, tenant, webhook_url FROM subscriptions WHERE tenant=$1")
            .bind(tenant.0)
            .fetch_all(&self.pool)
            .await?;
        let mut out = Vec::new();
        for r in &rows {
            let enc: String = r.get("webhook_url");
            let webhook_url = cc_crypto::decrypt_str(cipher, &enc)?;
            out.push(Subscription {
                id: r.get("id"),
                tenant: TenantId(r.get("tenant")),
                webhook_url,
            });
        }
        Ok(out)
    }
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p cc-stores --test secret_at_rest_it`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/stores/src/pg.rs crates/stores/tests/secret_at_rest_it.rs
git commit -m "Encrypt subscription webhook URLs at rest in Postgres"
```

---

## Task 7: `cc-api` — thread the cipher through AppState

**Files:**
- Modify: `crates/api/Cargo.toml`
- Modify: `crates/api/src/lib.rs:23-30` (AppState)
- Modify: `crates/api/src/receivers.rs:33-63`
- Modify: `crates/api/src/subscriptions.rs:29-33`
- Modify: any `crates/api/tests/*.rs` constructing `AppState`

- [ ] **Step 1: Add dependency + AppState field**

In `crates/api/Cargo.toml` under `[dependencies]` add:
```toml
cc-crypto = { path = "../crypto" }
```

In `crates/api/src/lib.rs`, add the import `use cc_crypto::SecretCipher;` (with the other `use` lines) and add a field to `AppState`:
```rust
    pub cipher: Arc<dyn SecretCipher>,
```
(`AppState` already derives `Clone` and imports `Arc`; `Arc<dyn SecretCipher>` is `Clone`.)

- [ ] **Step 2: Thread cipher into handlers**

In `crates/api/src/receivers.rs`, update the three store calls:
- `create`: `.create_receiver(&*state.cipher, t, &body.name, &body.channel)`
- `list`: `.list_receivers(&*state.cipher, t)`
- `get`: `.get_receiver(&*state.cipher, t, &name)`

In `crates/api/src/subscriptions.rs`, update `create`:
- `.create_subscription(&*state.cipher, t, &body.webhook_url)`

- [ ] **Step 3: Fix all `AppState { ... }` constructions**

Run: `grep -rn "AppState {" crates/api src` to find every construction site.
For each (in `crates/api/tests/*` and anywhere else), add `cipher: test_cipher(),` using the shared test-cipher snippet (add the imports + helper to each such test file). The production construction in `src/main.rs` is handled in Task 10 — if `grep` flags it, leave it for Task 10.

- [ ] **Step 4: Build + test the crate**

Run: `cargo test -p cc-api --no-run`
Expected: compiles.
Run: `cargo test -p cc-api`
Expected: existing api tests pass.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/api/Cargo.toml crates/api/src/lib.rs crates/api/src/receivers.rs crates/api/src/subscriptions.rs crates/api/tests Cargo.lock
git commit -m "Thread SecretCipher through API AppState and receiver/subscription handlers"
```

---

## Task 8: `cc-dispatcher` — encrypt the Redis group target, decrypt at flush, redact the audit log

**Files:**
- Modify: `crates/dispatcher/Cargo.toml`
- Modify: `crates/dispatcher/src/dedup.rs` (add `redact_target`)
- Modify: `crates/dispatcher/src/lib.rs` (`run_dispatcher`, `process_event`, `firehose_deliver`, `run_group_flusher`, `flush_group`, `deliver_one` logs)
- Modify: `crates/dispatcher/tests/routing_dispatch_it.rs`, `crates/dispatcher/tests/dispatch_it.rs`

- [ ] **Step 1: Add dependency**

In `crates/dispatcher/Cargo.toml` under `[dependencies]` add:
```toml
cc-crypto = { path = "../crypto" }
```

- [ ] **Step 2: Write the failing test for `redact_target`** — append to the `tests` module in `crates/dispatcher/src/dedup.rs`:

```rust
    #[test]
    fn redact_target_is_non_reversible_and_stable() {
        let a = redact_target("https://hooks.slack/SECRET");
        let b = redact_target("https://hooks.slack/SECRET");
        assert_eq!(a, b);
        assert!(a.starts_with("sha256:"));
        assert!(!a.contains("SECRET"));
        assert_ne!(a, redact_target("https://hooks.slack/OTHER"));
    }
```

- [ ] **Step 3: Run to confirm failure**

Run: `cargo test -p cc-dispatcher redact_target`
Expected: FAIL to compile (`redact_target` not found).

- [ ] **Step 4: Implement `redact_target`** — append to `crates/dispatcher/src/dedup.rs` (after `dedup_key`):

```rust
/// A non-reversible stand-in for a secret delivery target, safe to persist in the
/// notification audit log and emit in logs. High-entropy targets (URLs, routing keys)
/// cannot be recovered from this digest.
pub fn redact_target(target: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("sha256:{}", hex::encode(Sha256::digest(target.as_bytes())))
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `cargo test -p cc-dispatcher redact_target`
Expected: 1 passed.

- [ ] **Step 6: Thread the cipher and apply encryption** in `crates/dispatcher/src/lib.rs`. Add `use cc_crypto::SecretCipher;` and `use std::sync::Arc;` (Arc is likely already imported).

(a) `run_dispatcher` — add a `cipher` parameter (before `shutdown`) and pass it to `process_event`:
```rust
pub async fn run_dispatcher(
    consumer: String,
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifiers: Arc<Notifiers>,
    groups: Arc<dyn GroupStore>,
    cache: Arc<FilterCache>,
    cipher: Arc<dyn SecretCipher>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
```
In the loop, change the `process_event(...)` call to pass `cipher.as_ref()` as the new final argument before `&entry`:
```rust
            let ack_ok = process_event(
                &store,
                bus.as_ref(),
                notifiers.as_ref(),
                groups.as_ref(),
                cache.as_ref(),
                cipher.as_ref(),
                &entry,
            )
            .await;
```

(b) `process_event` — add `cipher: &dyn SecretCipher` (before `entry`). Change the receivers read and the `GroupMeta` construction:
- Receivers read: `let receivers = match store.list_receivers(cipher, ev.tenant).await {`
- Firehose call: `return firehose_deliver(store, bus, notifiers, cipher, ev, &entry.id).await;`
- Replace the `let meta = GroupMeta { ... target: ch.target(), ... };` block with:
```rust
        let enc_target = match cc_crypto::encrypt_str(cipher, &ch.target()) {
            Ok(t) => t,
            Err(e) => {
                tracing::error!(error = %e, group = %gid,
                    "encrypting channel target failed; leaving event unacked for reclaim");
                all_handled = false;
                continue;
            }
        };
        let meta = GroupMeta {
            tenant: ev.tenant.0,
            channel: ch.channel_name().to_string(),
            target: enc_target,
            group_key,
        };
```

(c) `firehose_deliver` — add `cipher: &dyn SecretCipher` (before `ev`). Change the subscriptions read and the audit write:
- `let subs = match store.subscriptions_for(cipher, ev.tenant).await {`
- Replace the `try_begin_notification` call's target argument with the redacted digest:
```rust
        match store
            .try_begin_notification(&key, ev.tenant, channel, &dedup::redact_target(&target))
            .await
```
(The `deliver_one(..., &target, ...)` call keeps the cleartext `target` for actual delivery.)

(d) `run_group_flusher` — add a `cipher` parameter (before `shutdown`) and pass it to `flush_group`:
```rust
pub async fn run_group_flusher(
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifiers: Arc<Notifiers>,
    groups: Arc<dyn GroupStore>,
    cipher: Arc<dyn SecretCipher>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
```
In the loop, pass `cipher.as_ref()` to `flush_group`:
```rust
            flush_group(
                &store,
                bus.as_ref(),
                notifiers.as_ref(),
                groups.as_ref(),
                cipher.as_ref(),
                &gid,
            )
            .await;
```

(e) `flush_group` — add `cipher: &dyn SecretCipher` (before `gid`). After building `notif` and `tenant`, decrypt the target and use the cleartext for dedup + delivery, and the redacted digest for the audit write:
```rust
    let target_clear = match cc_crypto::decrypt_str(cipher, &meta.target) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, group = %gid, "decrypting group target failed; dropping flush");
            return;
        }
    };
    let key = grouping::group_dedup_key(gid, &meta.channel, &target_clear, &notif.events);
    match store
        .try_begin_notification(&key, tenant, &meta.channel, &dedup::redact_target(&target_clear))
        .await
    {
        Ok(true) => {}
        Ok(false) => return,
        Err(e) => {
            tracing::error!(error = %e, group = %gid, "begin notification failed");
            return;
        }
    }
    let rep = notif.events[0].clone();
    deliver_one(
        store,
        bus,
        notifiers,
        &meta.channel,
        &target_clear,
        &key,
        &notif,
        &rep,
    )
    .await;
```

(f) `deliver_one` — redact the target in the two dead-letter log lines. Change both `target = %target` occurrences to `target = %dedup::redact_target(target)`.

- [ ] **Step 7: Fix dispatcher test call sites**

In `crates/dispatcher/tests/routing_dispatch_it.rs`: add the shared test-cipher snippet imports + helper; create `let cipher = test_cipher();` after the store; pass `cipher.as_ref()` to `create_receiver`; and pass `cipher.clone()` to `run_dispatcher`/`run_group_flusher` (before the shutdown receiver).

In `crates/dispatcher/tests/dispatch_it.rs`: same — add the cipher; pass `cipher.as_ref()` to `create_subscription`; pass `cipher.clone()` to `run_dispatcher` (and `run_group_flusher` if used).

- [ ] **Step 8: Build + run dispatcher tests**

Run: `cargo test -p cc-dispatcher`
Expected: existing dispatcher unit + integration tests pass.

- [ ] **Step 9: Commit**

```bash
cargo fmt --all
git add crates/dispatcher/Cargo.toml crates/dispatcher/src/lib.rs crates/dispatcher/src/dedup.rs crates/dispatcher/tests/routing_dispatch_it.rs crates/dispatcher/tests/dispatch_it.rs Cargo.lock
git commit -m "Encrypt Redis group target, decrypt at flush, redact notification audit target"
```

---

## Task 9: Dispatcher integration test — prove `GroupMeta.target` is encrypted in Redis

**Files:**
- Create: `crates/dispatcher/tests/group_secret_it.rs`

This test drives the public group-buffer path the dispatcher uses (`RedisGroups::add_to_group` with an encrypted target), then raw-reads the Redis hash `cc:group:{id}` field `__meta__` to prove no cleartext, and confirms decrypt + `take_group` round-trips.

- [ ] **Step 1: Write the test** — create `crates/dispatcher/tests/group_secret_it.rs`:

```rust
use cc_crypto::{EnvKeyring, SecretCipher};
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::rule::Severity;
use cc_queue::groups::{GroupMeta, GroupStore, RedisGroups};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(EnvKeyring::new(HashMap::from([("v1".to_string(), [7u8; 32])]), "v1".to_string()).unwrap())
}

fn sample_event(tenant: TenantId) -> Event {
    Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

#[tokio::test]
async fn group_meta_target_is_encrypted_in_redis() {
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!("redis://127.0.0.1:{}", redis.get_host_port_ipv4(6379).await.unwrap());
    let groups = RedisGroups::connect(&redis_url).await.unwrap();
    let cipher = test_cipher();
    let tenant = TenantId(Uuid::new_v4());

    // Buffer with an ENCRYPTED target, exactly as the dispatcher does.
    let secret = "https://hooks.slack/SECRET-XYZ";
    let enc_target = cc_crypto::encrypt_str(cipher.as_ref(), secret).unwrap();
    let gid = "g-test";
    let meta = GroupMeta {
        tenant: tenant.0,
        channel: "slack".into(),
        target: enc_target.clone(),
        group_key: "slack/[]".into(),
    };
    let ev = sample_event(tenant);
    groups
        .add_to_group(gid, &meta, "fp1", &ev, 0, 1000, 1000)
        .await
        .unwrap();

    // Raw Redis read: the secret must not be present anywhere in the group hash.
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let meta_raw: String = redis::cmd("HGET")
        .arg(format!("cc:group:{gid}"))
        .arg("__meta__")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(!meta_raw.contains("SECRET-XYZ"), "secret leaked into Redis: {meta_raw}");

    // take_group returns the encrypted target; decrypt restores cleartext.
    let (got_meta, events) = groups.take_group(gid, 1).await.unwrap().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(cc_crypto::decrypt_str(cipher.as_ref(), &got_meta.target).unwrap(), secret);
}
```

- [ ] **Step 2: Run**

Run: `cargo test -p cc-dispatcher --test group_secret_it`
Expected: 1 passed. (If the `redis` multiplexed-connection method name differs in the pinned `redis` 0.27, match the pattern used in `crates/queue/src/groups.rs` / existing queue tests.)

- [ ] **Step 3: Commit**

```bash
cargo fmt --all
git add crates/dispatcher/tests/group_secret_it.rs
git commit -m "Add integration test proving group target is encrypted in Redis"
```

---

## Task 10: Config + `src/main.rs` fail-closed wiring

**Files:**
- Modify: `Cargo.toml` (root) — add `cc-crypto` to the bin `[dependencies]`
- Modify: `src/config.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Add the bin dependency**

In the root `Cargo.toml` `[dependencies]` (where `cc-scheduler`, `cc-dispatcher`, etc. are listed for the `cc` binary), add:
```toml
cc-crypto = { path = "crates/crypto" }
```

- [ ] **Step 2: Add config fields** — in `src/config.rs`, add to `Config`:
```rust
    pub secret_provider: String,
    pub secret_keys: Option<String>,
    pub secret_active_key: Option<String>,
    pub kms_fake_root_key: Option<String>,
```
And in `from_env()`'s returned `Config { ... }`:
```rust
            secret_provider: var("CC_SECRET_PROVIDER", "env"),
            secret_keys: env::var("CC_SECRET_KEYS").ok(),
            secret_active_key: env::var("CC_SECRET_ACTIVE_KEY").ok(),
            kms_fake_root_key: env::var("CC_KMS_FAKE_ROOT_KEY").ok(),
```

- [ ] **Step 3: Build the cipher fail-closed and inject it** — in `src/main.rs`, right after `let cfg = Config::from_env();` (and before connecting stores):
```rust
    let cipher: std::sync::Arc<dyn cc_crypto::SecretCipher> = cc_crypto::build_cipher(
        cc_crypto::ProviderKind::parse(&cfg.secret_provider)?,
        cfg.secret_keys.as_deref(),
        cfg.secret_active_key.as_deref(),
        cfg.kms_fake_root_key.as_deref(),
    )?;
```
(Built unconditionally before role checks → fail-closed globally; `?` propagates to `main`'s `anyhow::Result`, exiting the process if key material is missing/invalid.)

In the `AppState { ... }` construction, add:
```rust
            cipher: cipher.clone(),
```

In the `run_scheduler`/`run_evaluator` blocks: no change. In the dispatcher block, pass the cipher to both spawns:
- `run_dispatcher(consumer, store, bus, notifiers, groups, cache, cipher.clone(), rx).await;`
- `run_group_flusher(store, bus, notifiers, groups, cipher.clone(), rx).await;`

(Capture `let cipher = cipher.clone();` inside each spawned block's binding list alongside the other clones, mirroring the existing pattern.)

- [ ] **Step 4: Build the binary**

Run: `cargo build -p cc@0.1.0`
Expected: compiles.

- [ ] **Step 5: Sanity-check fail-closed behavior manually (no test infra needed)**

Run: `CC_ROLE=api CC_SECRET_PROVIDER=env cargo run -p cc@0.1.0 2>&1 | head -5`
Expected: process exits with an error mentioning `CC_SECRET_KEYS required for env provider` (it must NOT start serving).

- [ ] **Step 6: Commit**

```bash
cargo fmt --all
git add Cargo.toml Cargo.lock src/config.rs src/main.rs
git commit -m "Build secret cipher fail-closed at startup and inject into API and dispatcher"
```

---

## Task 11: Rewire e2e tests + full workspace gate

**Files:**
- Modify: `tests/e2e_dispatch.rs`, `tests/e2e_grouping.rs`, `tests/e2e_routing.rs`, `tests/e2e_durability.rs`, `tests/e2e_silences_inhibition.rs`, `tests/e2e_reconcile_silence.rs`

Each e2e test constructs a `PgStore`, calls `create_receiver`/`create_subscription`, and spawns `run_dispatcher`/`run_group_flusher`. All now need a cipher.

- [ ] **Step 1: Add the cipher to each e2e file**

For every file above:
1. Add imports: `use cc_crypto::{EnvKeyring, SecretCipher};`, `use std::collections::HashMap;` (and `use std::sync::Arc;` if not present), plus the `test_cipher()` helper (shared snippet).
2. After the store is built, add `let cipher = test_cipher();`.
3. Update every `create_receiver(...)` / `create_subscription(...)` call to pass `cipher.as_ref()` as the first argument.
4. Update every `run_dispatcher(...)` / `run_group_flusher(...)` spawn to pass `cipher.clone()` as the new argument immediately before the shutdown receiver. Add `cipher` to the per-spawn clone binding list (e.g. `let (store, bus, groups, notifiers, cache, cipher, rx) = (store.clone(), ..., cipher.clone(), sd_rx.clone());`).

Concrete call-site references to update (verify by grep — see below):
- `tests/e2e_dispatch.rs:83` `create_subscription`; its `run_dispatcher` spawn.
- `tests/e2e_grouping.rs:83` `create_receiver`; its `run_dispatcher` + `run_group_flusher` spawns.
- `tests/e2e_routing.rs:68,78` `create_receiver` (×2); its dispatcher spawns.
- `tests/e2e_durability.rs:129` `create_subscription`; its dispatcher spawn.
- `tests/e2e_silences_inhibition.rs:94` `create_subscription`; its dispatcher spawn.
- `tests/e2e_reconcile_silence.rs:100` `create_subscription`; its dispatcher spawn.

- [ ] **Step 2: Catch any missed call site**

Run: `grep -rn "create_receiver\|create_subscription\|list_receivers\|subscriptions_for\|run_dispatcher\|run_group_flusher" tests crates src`
Expected: every hit either already passes a cipher or is a definition. Fix any stragglers.

- [ ] **Step 3: Compile everything**

Run: `cargo test --workspace --no-run`
Expected: the entire workspace (all crates + e2e) compiles.

- [ ] **Step 4: Full gate**

Run: `cargo fmt --all -- --check`
Expected: clean (if not, run `cargo fmt --all` and re-stage).

Run: `cargo clippy --all-targets -- -D warnings`
Expected: clean.

Run: `cargo test --workspace --no-fail-fast`
Expected: all green, 0 failures.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add tests Cargo.lock
git commit -m "Rewire e2e tests with secret cipher; full workspace green"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- New `cc-crypto` crate, `SecretCipher` trait, `Envelope`, `EnvKeyring` (rotation), `FakeKms` (envelope path) → Tasks 1–4. ✓
- `encrypt_channel`/`decrypt_channel`, `encrypt_str`/`decrypt_str`, `build_cipher`/`ProviderKind` → Task 4. ✓
- Per-secret structural envelope (type cleartext, email `to` cleartext) → Task 4 tests + impl. ✓
- Receivers encrypted at rest → Task 5 (+ raw-SQL proof). ✓
- Subscriptions encrypted at rest (added scope) → Task 6 (+ raw-SQL proof). ✓
- Redis `GroupMeta.target` encrypted at buffer / decrypted at flush → Task 8 (+ Task 9 raw-Redis proof). ✓
- `notifications.target` audit leak → **redacted** digest via `redact_target` (added scope decision) → Task 8. ✓
- Dead-letter log lines no longer print cleartext target → Task 8(f). ✓
- API `AppState.cipher`, redaction unchanged → Task 7. ✓
- Fail-closed startup, config additions, no DB migration → Task 10. ✓
- Full gate (clippy/fmt/workspace tests) → Task 11. ✓

**2. Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — every code step shows complete code. The only soft note is Task 9 Step 2's redis-connection-method caveat, which points to a concrete in-repo pattern to copy. ✓

**3. Type consistency:** `SecretCipher`, `Envelope{key_id,nonce,ciphertext,wrapped_dek}`, `EnvKeyring::new`/`from_spec`, `FakeKms::new`/`from_b64`, `ProviderKind::{Env,Kms,parse}`, `build_cipher(kind, secret_keys, active_key, kms_fake_root_key)`, `encrypt_channel`/`decrypt_channel`/`encrypt_str`/`decrypt_str`, `redact_target`, and the `&dyn SecretCipher` store params + `Arc<dyn SecretCipher>` run-loop params are used identically across all tasks. `GroupMeta` field names match `crates/queue/src/groups.rs`. ✓
