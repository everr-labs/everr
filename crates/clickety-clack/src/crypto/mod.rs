//! Application-level secret encryption (AES-256-GCM) for clickety-clack.
//!
//! A [`SecretCipher`] turns plaintext into a self-describing [`Envelope`] and back.
//! Two implementations are selected by config: [`EnvKeyring`] (versioned static keys)
//! and [`FakeKms`] (in-process envelope encryption proving the data-key-wrap path so a
//! real cloud KMS can be added later behind the same trait).

use crate::domain::receiver::ChannelConfig;
use aes_gcm::aead::{rand_core::RngCore, Aead, AeadCore, KeyInit, OsRng};
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

pub(crate) fn aead_encrypt(
    key: &[u8; 32],
    plaintext: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|_| CryptoError::Encrypt)?;
    Ok((nonce.to_vec(), ct))
}

pub(crate) fn aead_decrypt(
    key: &[u8; 32],
    nonce: &[u8],
    ct: &[u8],
) -> Result<Vec<u8>, CryptoError> {
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
    Ok(Envelope {
        key_id,
        nonce,
        ciphertext,
        wrapped_dek,
    })
}

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
            return Err(CryptoError::Config(format!(
                "active key '{active}' not in keyring"
            )));
        }
        Ok(Self { keys, active })
    }

    /// Parse `id:<base64-32B>,id2:<base64-32B>` and the active id from raw env strings.
    pub fn from_spec(keys_spec: &str, active: &str) -> Result<Self, CryptoError> {
        let mut keys = HashMap::new();
        for part in keys_spec
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
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
        Ok(Envelope {
            key_id: self.active.clone(),
            nonce,
            ciphertext,
            wrapped_dek: None,
        })
    }

    fn decrypt(&self, env: &Envelope) -> Result<Vec<u8>, CryptoError> {
        let key = self
            .keys
            .get(&env.key_id)
            .ok_or_else(|| CryptoError::UnknownKeyId(env.key_id.clone()))?;
        aead_decrypt(key, &env.nonce, &env.ciphertext)
    }
}

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
        Ok(Envelope {
            key_id: FAKE_KMS_KEY_ID.into(),
            nonce,
            ciphertext,
            wrapped_dek: Some(wrapped),
        })
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

/// Encrypt a UTF-8 string into a compact JSON envelope string (used for the Redis
/// group target and any single-secret field).
pub fn encrypt_str(c: &dyn SecretCipher, s: &str) -> Result<String, CryptoError> {
    Ok(serde_json::to_string(&envelope_to_value(
        &c.encrypt(s.as_bytes())?,
    ))?)
}

pub fn decrypt_str(c: &dyn SecretCipher, s: &str) -> Result<String, CryptoError> {
    let env = envelope_from_value(&serde_json::from_str(s)?)?;
    String::from_utf8(c.decrypt(&env)?).map_err(|_| CryptoError::Decrypt)
}

/// Serialize a `ChannelConfig` with secret fields replaced by encryption envelopes.
/// The `type` discriminant and non-secret fields (email recipients) stay cleartext.
pub fn encrypt_channel(c: &dyn SecretCipher, ch: &ChannelConfig) -> Result<Value, CryptoError> {
    let enc = |s: &str| -> Result<Value, CryptoError> {
        Ok(envelope_to_value(&c.encrypt(s.as_bytes())?))
    };
    Ok(match ch {
        ChannelConfig::Webhook { url } => json!({"type": "webhook", "url": enc(url)?}),
        ChannelConfig::Slack { url } => json!({"type": "slack", "url": enc(url)?}),
        ChannelConfig::Pagerduty { routing_key } => {
            json!({"type": "pagerduty", "routing_key": enc(routing_key)?})
        }
        ChannelConfig::Email { to } => json!({"type": "email", "to": to}),
        ChannelConfig::Telegram {
            bot_token,
            chat_ids,
        } => {
            json!({"type": "telegram", "bot_token": enc(bot_token)?, "chat_ids": chat_ids})
        }
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
        "pagerduty" => ChannelConfig::Pagerduty {
            routing_key: dec("routing_key")?,
        },
        "email" => {
            let to_val = v
                .get("to")
                .cloned()
                .ok_or_else(|| CryptoError::Envelope("email channel missing 'to'".into()))?;
            ChannelConfig::Email {
                to: serde_json::from_value(to_val)?,
            }
        }
        "telegram" => {
            let chat_ids_val = v.get("chat_ids").cloned().ok_or_else(|| {
                CryptoError::Envelope("telegram channel missing 'chat_ids'".into())
            })?;
            ChannelConfig::Telegram {
                bot_token: dec("bot_token")?,
                chat_ids: serde_json::from_value(chat_ids_val)?,
            }
        }
        other => {
            return Err(CryptoError::Envelope(format!(
                "unknown channel type '{other}'"
            )))
        }
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
            other => Err(CryptoError::Config(format!(
                "unknown CC_SECRET_PROVIDER '{other}'"
            ))),
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
            let keys = secret_keys.ok_or_else(|| {
                CryptoError::Config("CC_SECRET_KEYS required for env provider".into())
            })?;
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
        let env = Envelope {
            key_id: "fake-kms-root".into(),
            nonce: vec![0; 12],
            ciphertext: vec![1],
            wrapped_dek: None,
        };
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
        let old = EnvKeyring::new(
            HashMap::from([("v1".to_string(), [1u8; 32])]),
            "v1".to_string(),
        )
        .unwrap();
        let env = old.encrypt(b"legacy").unwrap();
        assert_eq!(env.key_id, "v1");
        assert_eq!(keyring().decrypt(&env).unwrap(), b"legacy");
    }

    #[test]
    fn unknown_key_id_errors() {
        let env = Envelope {
            key_id: "v9".into(),
            nonce: vec![0; 12],
            ciphertext: vec![1],
            wrapped_dek: None,
        };
        assert!(matches!(
            keyring().decrypt(&env),
            Err(CryptoError::UnknownKeyId(_))
        ));
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
        let e = EnvKeyring::new(
            HashMap::from([("v1".to_string(), [1u8; 32])]),
            "v2".to_string(),
        );
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

        assert!(EnvKeyring::from_spec("", "a").is_err());
        assert!(EnvKeyring::from_spec(&format!("a:{k32}"), "z").is_err());
        assert!(EnvKeyring::from_spec("a:not-base64", "a").is_err());
        let short = STANDARD.encode([0u8; 16]);
        assert!(EnvKeyring::from_spec(&format!("a:{short}"), "a").is_err());
    }
}

#[cfg(test)]
mod helper_tests {
    use super::*;
    use crate::domain::receiver::ChannelConfig;

    fn cipher() -> EnvKeyring {
        EnvKeyring::new(
            HashMap::from([("v1".to_string(), [9u8; 32])]),
            "v1".to_string(),
        )
        .unwrap()
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
            ChannelConfig::Slack {
                url: "https://hooks.slack/SECRET".into(),
            },
            ChannelConfig::Webhook {
                url: "https://wh/AUTH".into(),
            },
            ChannelConfig::Pagerduty {
                routing_key: "PD-KEY".into(),
            },
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
        let ch = ChannelConfig::Email {
            to: vec!["a@x.test".into(), "b@x.test".into()],
        };
        let v = encrypt_channel(&c, &ch).unwrap();
        assert_eq!(v["type"], "email");
        assert_eq!(v["to"][0], "a@x.test");
        assert_eq!(decrypt_channel(&c, &v).unwrap(), ch);
    }

    #[test]
    fn telegram_channel_encrypts_token_keeps_chat_ids_cleartext() {
        let c = EnvKeyring::new(
            std::collections::HashMap::from([("v1".to_string(), [9u8; 32])]),
            "v1".to_string(),
        )
        .unwrap();
        let ch = ChannelConfig::Telegram {
            bot_token: "111:AAtoken".into(),
            chat_ids: vec!["@ops".into()],
        };
        let enc = encrypt_channel(&c, &ch).unwrap();
        // chat_ids cleartext; bot_token is an envelope object, not the plaintext.
        assert_eq!(enc["chat_ids"][0], "@ops");
        assert!(enc["bot_token"].is_object());
        assert_ne!(enc["bot_token"], serde_json::json!("111:AAtoken"));
        let back = decrypt_channel(&c, &enc).unwrap();
        assert_eq!(back, ch);
    }

    #[test]
    fn decrypt_channel_rejects_unknown_type() {
        let v = serde_json::json!({"type":"carrier-pigeon"});
        assert!(decrypt_channel(&cipher(), &v).is_err());
    }

    #[test]
    fn build_cipher_env_happy_and_fail_closed() {
        let k32 = STANDARD.encode([4u8; 32]);
        let ok = build_cipher(
            ProviderKind::Env,
            Some(&format!("v1:{k32}")),
            Some("v1"),
            None,
        );
        assert!(ok.is_ok());
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
        assert!(matches!(
            ProviderKind::parse("env").unwrap(),
            ProviderKind::Env
        ));
        assert!(matches!(
            ProviderKind::parse("kms").unwrap(),
            ProviderKind::Kms
        ));
        assert!(ProviderKind::parse("nope").is_err());
    }
}
