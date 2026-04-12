#[cfg(debug_assertions)]
pub const OTLP_HTTP_PORT: u16 = 54318;

#[cfg(not(debug_assertions))]
pub const OTLP_HTTP_PORT: u16 = 54418;

#[cfg(debug_assertions)]
pub const HEALTHCHECK_PORT: u16 = 54319;

#[cfg(not(debug_assertions))]
pub const HEALTHCHECK_PORT: u16 = 54419;
