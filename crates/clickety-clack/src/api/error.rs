use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub enum ApiError {
    Unauthorized,
    /// API-key gate rejection (missing/invalid `Authorization: Bearer <key>`).
    InvalidApiKey,
    /// A tenant-bound API key was used with an `X-CC-Tenant` header naming a
    /// different tenant.
    TenantMismatch,
    NotFound,
    /// Optimistic-concurrency failure (e.g. rule `version` mismatch on update).
    Conflict(String),
    /// Malformed request input that never names a valid value (e.g. an opaque
    /// pagination cursor that fails to decode), as opposed to a well-formed
    /// field with an invalid value (`Validation`, 422).
    BadRequest(String),
    Validation(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, detail) = match self {
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "missing or invalid tenant".to_string(),
            ),
            ApiError::InvalidApiKey => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "missing or invalid API key".to_string(),
            ),
            ApiError::TenantMismatch => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "API key is not authorized for the requested tenant".to_string(),
            ),
            ApiError::NotFound => (
                StatusCode::NOT_FOUND,
                "not_found",
                "resource not found".to_string(),
            ),
            ApiError::Conflict(d) => (StatusCode::CONFLICT, "conflict", d),
            ApiError::BadRequest(d) => (StatusCode::BAD_REQUEST, "bad_request", d),
            ApiError::Validation(d) => (StatusCode::UNPROCESSABLE_ENTITY, "validation_failed", d),
            ApiError::Internal(d) => {
                tracing::error!(detail = %d, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "internal server error".to_string(),
                )
            }
        };
        let body = Json(json!({
            "type": "about:blank",
            "title": code,
            "status": status.as_u16(),
            "detail": detail,
            "code": code,
        }));
        (status, body).into_response()
    }
}
