use crate::api::error::ApiError;
use crate::domain::ids::TenantId;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::sync::Arc;
use subtle::ConstantTimeEq;

/// The header a caller uses to select the tenant it acts for.
pub const TENANT_HEADER: &str = "X-CC-Tenant";

/// Resolves a request's credentials to a tenant. Real everr auth swaps in here.
pub trait Authenticator: Send + Sync + 'static {
    fn tenant_from(&self, headers: &HeaderMap) -> Option<TenantId>;
}

/// Phase 1 stub: trust an `X-CC-Tenant: <uuid>` header. When the API-key gate
/// runs with a tenant-bound key (see [`ApiKeySet`]), the gate middleware has
/// already derived and stamped this header from the key, so "trusting" it here
/// is trusting the key binding.
pub struct HeaderAuth;

impl Authenticator for HeaderAuth {
    fn tenant_from(&self, headers: &HeaderMap) -> Option<TenantId> {
        let raw = headers.get(TENANT_HEADER)?.to_str().ok()?;
        TenantId::parse(raw).ok()
    }
}

/// One configured API key, optionally bound to a single tenant.
struct KeyEntry {
    key: String,
    /// `Some` = requests with this key act as exactly this tenant.
    tenant: Option<TenantId>,
}

/// Outcome of matching a presented key against the configured set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyMatch {
    /// No configured entry matched.
    NoMatch,
    /// An unbound entry matched: the caller may act as any tenant (legacy mode).
    Unbound,
    /// A tenant-bound entry matched: the request's tenant is derived from the key.
    Bound(TenantId),
}

/// Static bearer-key allow-list gating the `/v1` routes.
///
/// Built from `CC_API_KEYS` (comma-separated so a key can rotate: serve the old
/// and new key together while clients switch, then drop the old one). An empty
/// set disables the gate entirely, which is the dev default: with no keys
/// configured the API behaves exactly as before this gate existed.
///
/// Two entry forms may be mixed in one list:
/// - `<key>`: a plain key; the caller asserts its tenant via `X-CC-Tenant`.
/// - `<key>@<tenant-id>`: a key bound to one tenant. The request's tenant is
///   derived from the key; an `X-CC-Tenant` header, if present, must agree.
///
/// A bound entry whose tenant part does not parse is rejected at startup (the
/// entry can never match) rather than silently demoted to an unbound key; the
/// gate stays enabled, so a typo fails closed instead of widening access.
#[derive(Clone, Default)]
pub struct ApiKeySet {
    entries: Arc<Vec<KeyEntry>>,
    /// True when the raw value contained any non-empty entry, even if every
    /// entry was rejected as malformed. Keeps a misconfigured gate closed.
    configured: bool,
}

impl ApiKeySet {
    /// Parse the raw `CC_API_KEYS` value. Entries are comma-separated;
    /// whitespace around entries is trimmed and empty entries are dropped.
    /// `None` (or a value with no non-empty entries) yields a disabled set.
    /// An entry containing `@` is a tenant-bound key: the part after the LAST
    /// `@` must be a valid tenant id (tenant ids cannot contain `@`).
    pub fn from_env_value(raw: Option<&str>) -> Self {
        let mut configured = false;
        let mut entries = Vec::new();
        for item in raw.unwrap_or_default().split(',') {
            let item = item.trim();
            if item.is_empty() {
                continue;
            }
            configured = true;
            match item.rsplit_once('@') {
                None => entries.push(KeyEntry {
                    key: item.to_string(),
                    tenant: None,
                }),
                Some((key, tenant_raw)) => match TenantId::parse(tenant_raw) {
                    Ok(tenant) if !key.is_empty() => entries.push(KeyEntry {
                        key: key.to_string(),
                        tenant: Some(tenant),
                    }),
                    _ => {
                        tracing::error!(
                            "CC_API_KEYS entry with '@' has an empty key or invalid tenant id; \
                             entry dropped (it will never match)"
                        );
                    }
                },
            }
        }
        Self {
            entries: Arc::new(entries),
            configured,
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.configured
    }

    /// Constant-time membership check. Every configured entry is compared (no
    /// early return on match) so timing reveals nothing about key contents or
    /// which entry matched. On duplicate keys the first matching entry wins.
    fn check(&self, presented: &str) -> KeyMatch {
        let presented = presented.as_bytes();
        let mut first_hit: Option<&KeyEntry> = None;
        for entry in self.entries.iter() {
            let hit = bool::from(entry.key.as_bytes().ct_eq(presented));
            if hit && first_hit.is_none() {
                first_hit = Some(entry);
            }
        }
        match first_hit {
            None => KeyMatch::NoMatch,
            Some(e) => match &e.tenant {
                None => KeyMatch::Unbound,
                Some(t) => KeyMatch::Bound(t.clone()),
            },
        }
    }

    #[cfg(test)]
    fn matches(&self, presented: &str) -> bool {
        self.check(presented) != KeyMatch::NoMatch
    }
}

/// Middleware enforcing `Authorization: Bearer <key>` against an [`ApiKeySet`].
/// A disabled (empty) set passes every request through unchanged. Mounted on
/// the `/v1` subtree only (the SSE stream included); `/healthz` and `/readyz`
/// live outside this layer.
///
/// For a tenant-bound key the tenant is derived from the key: the middleware
/// stamps `X-CC-Tenant` with the bound tenant before the handlers run, so the
/// downstream [`HeaderAuth`] resolution cannot be steered by the caller. If the
/// caller also sent `X-CC-Tenant`, it must equal the bound tenant or the
/// request is rejected with 401.
pub async fn require_api_key(
    State(keys): State<ApiKeySet>,
    mut req: Request,
    next: Next,
) -> Response {
    if !keys.is_enabled() {
        return next.run(req).await;
    }
    let presented = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let Some(token) = presented else {
        return ApiError::InvalidApiKey.into_response();
    };
    match keys.check(token) {
        KeyMatch::NoMatch => ApiError::InvalidApiKey.into_response(),
        KeyMatch::Unbound => next.run(req).await,
        KeyMatch::Bound(tenant) => {
            if let Some(asserted) = req.headers().get(TENANT_HEADER) {
                if asserted.as_bytes() != tenant.as_str().as_bytes() {
                    return ApiError::TenantMismatch.into_response();
                }
            }
            // Tenant ids match ^[A-Za-z0-9_.-]{1,64}$, always a valid header value.
            match HeaderValue::from_str(tenant.as_str()) {
                Ok(v) => {
                    req.headers_mut().insert(TENANT_HEADER, v);
                }
                Err(_) => return ApiError::TenantMismatch.into_response(),
            }
            next.run(req).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use axum::middleware;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    #[test]
    fn from_env_value_parses_and_trims() {
        let set = ApiKeySet::from_env_value(Some(" key-a , key-b ,, "));
        assert!(set.is_enabled());
        assert!(set.matches("key-a"));
        assert!(set.matches("key-b"));
        assert!(!set.matches("key-c"));
        assert!(!set.matches(""));
    }

    #[test]
    fn unset_or_blank_disables_the_gate() {
        assert!(!ApiKeySet::from_env_value(None).is_enabled());
        assert!(!ApiKeySet::from_env_value(Some("")).is_enabled());
        assert!(!ApiKeySet::from_env_value(Some(" , ")).is_enabled());
    }

    #[test]
    fn bound_entry_parses_and_derives_tenant() {
        let set = ApiKeySet::from_env_value(Some("secret@tenant-a"));
        assert!(set.is_enabled());
        assert_eq!(
            set.check("secret"),
            KeyMatch::Bound(TenantId::parse("tenant-a").unwrap())
        );
        // The full raw entry is not itself a key.
        assert_eq!(set.check("secret@tenant-a"), KeyMatch::NoMatch);
    }

    #[test]
    fn mixed_list_keeps_unbound_behavior() {
        let set = ApiKeySet::from_env_value(Some("global-key, scoped@tenant-b"));
        assert_eq!(set.check("global-key"), KeyMatch::Unbound);
        assert_eq!(
            set.check("scoped"),
            KeyMatch::Bound(TenantId::parse("tenant-b").unwrap())
        );
        assert_eq!(set.check("other"), KeyMatch::NoMatch);
    }

    #[test]
    fn malformed_bound_entries_fail_closed() {
        // Invalid tenant part and empty key part: entries dropped, gate stays on.
        for raw in ["key@bad tenant!", "@tenant-a", "key@"] {
            let set = ApiKeySet::from_env_value(Some(raw));
            assert!(set.is_enabled(), "{raw:?} must keep the gate enabled");
            assert_eq!(set.check("key"), KeyMatch::NoMatch, "{raw:?}");
        }
    }

    #[test]
    fn key_containing_at_binds_to_the_last_at() {
        // '@' cannot appear in a tenant id, so the split at the last '@' is
        // unambiguous: everything before it is the key, verbatim.
        let set = ApiKeySet::from_env_value(Some("we@ird-key@tenant-c"));
        assert_eq!(
            set.check("we@ird-key"),
            KeyMatch::Bound(TenantId::parse("tenant-c").unwrap())
        );
    }

    /// No early exit: the scan touches every entry whether the match is first,
    /// last, or absent. Guarded by construction (the loop has no `break` or
    /// `return`); this test pins the observable first-match-wins semantics that
    /// the full scan implies for duplicate keys.
    #[test]
    fn full_scan_first_match_wins_on_duplicates() {
        // Same key bound and unbound: first entry decides.
        let set = ApiKeySet::from_env_value(Some("k@tenant-a, k"));
        assert_eq!(
            set.check("k"),
            KeyMatch::Bound(TenantId::parse("tenant-a").unwrap())
        );
        let set = ApiKeySet::from_env_value(Some("k, k@tenant-a"));
        assert_eq!(set.check("k"), KeyMatch::Unbound);
        // Matching the last entry works (the scan reached it).
        let set = ApiKeySet::from_env_value(Some("a, b, c@tenant-z"));
        assert_eq!(
            set.check("c"),
            KeyMatch::Bound(TenantId::parse("tenant-z").unwrap())
        );
    }

    // ---- middleware-level tests (probe handler echoes the resolved header) ----

    fn app(set: ApiKeySet) -> Router {
        Router::new()
            .route(
                "/v1/probe",
                get(|headers: HeaderMap| async move {
                    headers
                        .get(TENANT_HEADER)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("<none>")
                        .to_string()
                }),
            )
            .layer(middleware::from_fn_with_state(set, require_api_key))
    }

    async fn send(
        router: Router,
        auth: Option<&str>,
        tenant: Option<&str>,
    ) -> (StatusCode, String) {
        let mut req = axum::http::Request::builder().uri("/v1/probe");
        if let Some(a) = auth {
            req = req.header("Authorization", a);
        }
        if let Some(t) = tenant {
            req = req.header(TENANT_HEADER, t);
        }
        let res = router
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = http_body_util::BodyExt::collect(res.into_body())
            .await
            .unwrap()
            .to_bytes();
        (status, String::from_utf8_lossy(&bytes).to_string())
    }

    #[tokio::test]
    async fn bound_key_derives_tenant_without_header() {
        let router = app(ApiKeySet::from_env_value(Some("secret@tenant-a")));
        let (status, body) = send(router, Some("Bearer secret"), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "tenant-a");
    }

    #[tokio::test]
    async fn bound_key_with_matching_header_passes() {
        let router = app(ApiKeySet::from_env_value(Some("secret@tenant-a")));
        let (status, body) = send(router, Some("Bearer secret"), Some("tenant-a")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "tenant-a");
    }

    #[tokio::test]
    async fn bound_key_with_mismatched_header_401s() {
        let router = app(ApiKeySet::from_env_value(Some("secret@tenant-a")));
        let (status, body) = send(router, Some("Bearer secret"), Some("tenant-b")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(
            body.contains("not authorized for the requested tenant"),
            "{body}"
        );
    }

    #[tokio::test]
    async fn unbound_key_keeps_header_asserted_tenant() {
        let router = app(ApiKeySet::from_env_value(Some("global")));
        let (status, body) = send(router, Some("Bearer global"), Some("tenant-x")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "tenant-x");
    }

    #[tokio::test]
    async fn wrong_or_missing_key_401s() {
        let set = ApiKeySet::from_env_value(Some("secret@tenant-a, global"));
        let (status, _) = send(app(set.clone()), Some("Bearer nope"), None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let (status, _) = send(app(set), None, Some("tenant-a")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn disabled_gate_passes_through() {
        let router = app(ApiKeySet::default());
        let (status, body) = send(router, None, Some("tenant-y")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "tenant-y");
    }
}
