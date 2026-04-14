use std::time::{Duration, SystemTime};

/// Time unit for date math operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Second,
    Minute,
    Hour,
    Day,
    Week,
    Month,
    Year,
}

/// A single add, subtract, or round operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Op {
    Add(u32, Unit),
    Sub(u32, Unit),
    Round(Unit),
}

/// Parsed date math expression: an anchor plus operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expression {
    pub anchor: Anchor,
    pub ops: Vec<Op>,
}

/// The anchor of a date math expression.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Anchor {
    Now,
    /// Epoch seconds from an ISO-8601 date string.
    Absolute(i64),
}

/// Error returned when a date math expression cannot be parsed.
#[derive(Debug, Clone)]
pub struct DateMathError {
    pub message: String,
    pub expression: String,
    pub position: Option<usize>,
}

impl std::fmt::Display for DateMathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for DateMathError {}

fn parse_unit(c: u8) -> Option<Unit> {
    match c {
        b's' => Some(Unit::Second),
        b'm' => Some(Unit::Minute),
        b'h' => Some(Unit::Hour),
        b'd' => Some(Unit::Day),
        b'w' => Some(Unit::Week),
        b'M' => Some(Unit::Month),
        b'y' => Some(Unit::Year),
        _ => None,
    }
}

/// Parse a date math expression string.
///
/// Supports `"now"` as a relative anchor or an ISO-8601 date string separated
/// from math operators by `||`. Operators are `+`, `-`, and `/` (round)
/// followed by an optional amount and a unit (`s`, `m`, `h`, `d`, `w`, `M`, `y`).
///
/// Examples: `"now-1h"`, `"now-7d/d"`, `"2024-01-01||+1M"`.
pub fn parse(expression: &str) -> Result<Expression, DateMathError> {
    let input: String = expression.chars().filter(|c| !c.is_whitespace()).collect();

    if input.is_empty() {
        return Err(DateMathError {
            message: "Empty expression".into(),
            expression: expression.into(),
            position: None,
        });
    }

    let (anchor, math_part) = if input.starts_with("now") {
        (Anchor::Now, &input[3..])
    } else if let Some(sep) = input.find("||") {
        let date_str = &input[..sep];
        let anchor = parse_iso_anchor(date_str, expression)?;
        (anchor, &input[sep + 2..])
    } else {
        let anchor = parse_iso_anchor(&input, expression)?;
        (anchor, "")
    };

    let ops = parse_math_ops(math_part.as_bytes(), expression)?;

    Ok(Expression { anchor, ops })
}

fn parse_iso_anchor(s: &str, expression: &str) -> Result<Anchor, DateMathError> {
    if s.is_empty() {
        return Err(DateMathError {
            message: "Empty anchor".into(),
            expression: expression.into(),
            position: Some(0),
        });
    }
    // Try chrono-style parsing for common ISO-8601 formats.
    // We support: YYYY-MM-DD, YYYY-MM-DDThh:mm:ssZ, YYYY-MM-DDThh:mm:ss±hh:mm
    let epoch = parse_iso_to_epoch_secs(s).ok_or_else(|| DateMathError {
        message: format!("Invalid date anchor: {s}"),
        expression: expression.into(),
        position: Some(0),
    })?;
    Ok(Anchor::Absolute(epoch))
}

/// Minimal ISO-8601 parser → epoch seconds. Returns None on invalid input.
fn parse_iso_to_epoch_secs(s: &str) -> Option<i64> {
    // Delegate to chrono if available; otherwise hand-roll for common formats.
    // We'll hand-roll to avoid adding a dependency.

    // Formats we handle:
    //   YYYY-MM-DD                     (midnight UTC)
    //   YYYY-MM-DDThh:mm:ss[.fff]Z
    //   YYYY-MM-DDThh:mm:ss[.fff]±hh:mm

    let (date_part, time_rest) = if let Some(t_pos) = s.find('T') {
        (&s[..t_pos], Some(&s[t_pos + 1..]))
    } else {
        (s, None)
    };

    let date_parts: Vec<&str> = date_part.split('-').collect();
    if date_parts.len() != 3 {
        return None;
    }
    let year: i64 = date_parts[0].parse().ok()?;
    let month: u32 = date_parts[1].parse().ok()?;
    let day: u32 = date_parts[2].parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let (hour, minute, second, tz_offset_secs) = if let Some(time_str) = time_rest {
        parse_time_and_tz(time_str)?
    } else {
        (0, 0, 0, 0i64)
    };

    // Convert to epoch seconds using a simplified algorithm.
    let epoch_days = days_from_civil(year, month, day);
    let epoch_secs = epoch_days * 86400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64;
    Some(epoch_secs - tz_offset_secs)
}

/// Parse time portion like "12:00:00Z" or "12:00:00.123+05:30"
/// Returns (hour, minute, second, tz_offset_seconds)
fn parse_time_and_tz(s: &str) -> Option<(u32, u32, u32, i64)> {
    // Find timezone marker: Z, +, or - (but not the first char for negative)
    let tz_start = s
        .find('Z')
        .or_else(|| s.rfind('+'))
        .or_else(|| {
            // Find last '-' that's a timezone marker (after position 2 to skip time digits)
            s[2..].rfind('-').map(|i| i + 2)
        });

    let (time_part, tz_offset) = if let Some(pos) = tz_start {
        let tz_str = &s[pos..];
        let offset = parse_tz_offset(tz_str)?;
        (&s[..pos], offset)
    } else {
        (s, 0i64)
    };

    // Strip fractional seconds
    let time_no_frac = if let Some(dot) = time_part.find('.') {
        &time_part[..dot]
    } else {
        time_part
    };

    let parts: Vec<&str> = time_no_frac.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: u32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let sec: u32 = parts[2].parse().ok()?;
    Some((h, m, sec, tz_offset))
}

fn parse_tz_offset(s: &str) -> Option<i64> {
    if s == "Z" {
        return Some(0);
    }
    let sign: i64 = if s.starts_with('+') { 1 } else { -1 };
    let rest = &s[1..];
    let parts: Vec<&str> = rest.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let h: i64 = parts[0].parse().ok()?;
    let m: i64 = parts[1].parse().ok()?;
    Some(sign * (h * 3600 + m * 60))
}

/// Civil date → days since Unix epoch (algorithm from Howard Hinnant).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let m = if month <= 2 {
        month as i64 + 9
    } else {
        month as i64 - 3
    };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let doy = (153 * m as u64 + 2) / 5 + day as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}

fn parse_math_ops(bytes: &[u8], expression: &str) -> Result<Vec<Op>, DateMathError> {
    let mut ops = Vec::new();
    let mut pos = 0;

    while pos < bytes.len() {
        match bytes[pos] {
            b'/' => {
                pos += 1;
                if pos >= bytes.len() {
                    return Err(DateMathError {
                        message: "Expected unit after /".into(),
                        expression: expression.into(),
                        position: Some(pos),
                    });
                }
                let unit = parse_unit(bytes[pos]).ok_or_else(|| DateMathError {
                    message: format!("Invalid unit: {}", bytes[pos] as char),
                    expression: expression.into(),
                    position: Some(pos),
                })?;
                ops.push(Op::Round(unit));
                pos += 1;
            }
            b'+' | b'-' => {
                let is_add = bytes[pos] == b'+';
                pos += 1;

                let mut amount_str = String::new();
                while pos < bytes.len() && bytes[pos].is_ascii_digit() {
                    amount_str.push(bytes[pos] as char);
                    pos += 1;
                }

                if pos >= bytes.len() {
                    return Err(DateMathError {
                        message: "Expected unit after operator".into(),
                        expression: expression.into(),
                        position: Some(pos),
                    });
                }

                let unit = parse_unit(bytes[pos]).ok_or_else(|| DateMathError {
                    message: format!("Invalid unit: {}", bytes[pos] as char),
                    expression: expression.into(),
                    position: Some(pos),
                })?;

                let amount: u32 = if amount_str.is_empty() {
                    1
                } else {
                    amount_str.parse().map_err(|_| DateMathError {
                        message: format!("Invalid number: {amount_str}"),
                        expression: expression.into(),
                        position: Some(pos),
                    })?
                };

                if is_add {
                    ops.push(Op::Add(amount, unit));
                } else {
                    ops.push(Op::Sub(amount, unit));
                }
                pos += 1;
            }
            c => {
                return Err(DateMathError {
                    message: format!("Unexpected character: {}", c as char),
                    expression: expression.into(),
                    position: Some(pos),
                });
            }
        }
    }

    Ok(ops)
}

/// Resolve a date math expression to an absolute [`SystemTime`].
///
/// The `now` parameter overrides the current time (useful for testing).
pub fn resolve(expression: &str, now: SystemTime) -> Result<SystemTime, DateMathError> {
    let expr = parse(expression)?;
    evaluate(&expr, now)
}

/// Resolve a date math expression to epoch nanoseconds.
pub fn resolve_to_epoch_ns(expression: &str, now: SystemTime) -> Result<u64, DateMathError> {
    let t = resolve(expression, now)?;
    Ok(system_time_to_epoch_ns(t))
}

fn system_time_to_epoch_ns(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// Evaluate a parsed expression to a [`SystemTime`].
pub fn evaluate(expr: &Expression, now: SystemTime) -> Result<SystemTime, DateMathError> {
    let mut epoch_secs: i64 = match &expr.anchor {
        Anchor::Now => {
            let d = now
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or(Duration::ZERO);
            d.as_secs() as i64
        }
        Anchor::Absolute(secs) => *secs,
    };

    for op in &expr.ops {
        match op {
            Op::Add(amount, unit) => {
                epoch_secs = add_to_epoch(epoch_secs, *amount as i64, *unit);
            }
            Op::Sub(amount, unit) => {
                epoch_secs = add_to_epoch(epoch_secs, -(*amount as i64), *unit);
            }
            Op::Round(unit) => {
                epoch_secs = round_down(epoch_secs, *unit);
            }
        }
    }

    let duration = Duration::from_secs(epoch_secs.max(0) as u64);
    Ok(SystemTime::UNIX_EPOCH + duration)
}

fn add_to_epoch(epoch_secs: i64, amount: i64, unit: Unit) -> i64 {
    match unit {
        Unit::Second => epoch_secs + amount,
        Unit::Minute => epoch_secs + amount * 60,
        Unit::Hour => epoch_secs + amount * 3600,
        Unit::Day => epoch_secs + amount * 86400,
        Unit::Week => epoch_secs + amount * 7 * 86400,
        Unit::Month => {
            let (y, m, d, hms) = epoch_to_civil(epoch_secs);
            let total_months = y * 12 + (m as i64 - 1) + amount;
            let new_y = total_months.div_euclid(12);
            let new_m = (total_months.rem_euclid(12) + 1) as u32;
            let max_day = days_in_month(new_y, new_m);
            let new_d = d.min(max_day);
            days_from_civil(new_y, new_m, new_d) * 86400 + hms
        }
        Unit::Year => {
            let (y, m, d, hms) = epoch_to_civil(epoch_secs);
            let new_y = y + amount;
            let max_day = days_in_month(new_y, m);
            let new_d = d.min(max_day);
            days_from_civil(new_y, m, new_d) * 86400 + hms
        }
    }
}

/// Convert epoch seconds to (year, month, day, seconds-within-day).
fn epoch_to_civil(epoch_secs: i64) -> (i64, u32, u32, i64) {
    let day_secs = epoch_secs.rem_euclid(86400);
    let days = (epoch_secs - day_secs) / 86400;

    // Reverse of days_from_civil (Howard Hinnant's algorithm)
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };

    (y, m, d, day_secs)
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(year) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn is_leap(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

/// Round epoch seconds down to the start of the given unit (UTC).
fn round_down(epoch_secs: i64, unit: Unit) -> i64 {
    match unit {
        Unit::Second => epoch_secs,
        Unit::Minute => epoch_secs - epoch_secs.rem_euclid(60),
        Unit::Hour => epoch_secs - epoch_secs.rem_euclid(3600),
        Unit::Day => epoch_secs - epoch_secs.rem_euclid(86400),
        Unit::Week => {
            // Unix epoch (1970-01-01) was a Thursday. Monday-based ISO weeks:
            // Thursday = day 4, so epoch day 0 offset from Monday = 3 days.
            let day_start = epoch_secs - epoch_secs.rem_euclid(86400);
            let days_since_epoch = day_start / 86400;
            // (days_since_epoch + 3) % 7 gives day-of-week (0=Monday)
            let dow = (days_since_epoch + 3).rem_euclid(7);
            day_start - dow * 86400
        }
        Unit::Month => {
            let (y, m, _, _) = epoch_to_civil(epoch_secs);
            days_from_civil(y, m, 1) * 86400
        }
        Unit::Year => {
            let (y, _, _, _) = epoch_to_civil(epoch_secs);
            days_from_civil(y, 1, 1) * 86400
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_now() {
        let expr = parse("now").unwrap();
        assert_eq!(expr.anchor, Anchor::Now);
        assert!(expr.ops.is_empty());
    }

    #[test]
    fn parse_now_sub_7d() {
        let expr = parse("now-7d").unwrap();
        assert_eq!(expr.ops, vec![Op::Sub(7, Unit::Day)]);
    }

    #[test]
    fn parse_now_add_1h() {
        let expr = parse("now+1h").unwrap();
        assert_eq!(expr.ops, vec![Op::Add(1, Unit::Hour)]);
    }

    #[test]
    fn parse_now_round() {
        let expr = parse("now/d").unwrap();
        assert_eq!(expr.ops, vec![Op::Round(Unit::Day)]);
    }

    #[test]
    fn parse_chained() {
        let expr = parse("now-7d/d").unwrap();
        assert_eq!(expr.ops, vec![Op::Sub(7, Unit::Day), Op::Round(Unit::Day)]);
    }

    #[test]
    fn parse_absolute_with_math() {
        let expr = parse("2024-01-01||+1M/d").unwrap();
        assert_eq!(
            expr.ops,
            vec![Op::Add(1, Unit::Month), Op::Round(Unit::Day)]
        );
        assert!(matches!(expr.anchor, Anchor::Absolute(_)));
    }

    #[test]
    fn parse_implicit_amount() {
        let expr = parse("now+d").unwrap();
        assert_eq!(expr.ops, vec![Op::Add(1, Unit::Day)]);
    }

    #[test]
    fn parse_all_units() {
        for (ch, unit) in [
            ("s", Unit::Second),
            ("m", Unit::Minute),
            ("h", Unit::Hour),
            ("d", Unit::Day),
            ("w", Unit::Week),
            ("M", Unit::Month),
            ("y", Unit::Year),
        ] {
            let expr = parse(&format!("now+1{ch}")).unwrap();
            assert_eq!(expr.ops, vec![Op::Add(1, unit)]);
        }
    }

    #[test]
    fn parse_strips_whitespace() {
        let a = parse("now - 7d").unwrap();
        let b = parse("now-7d").unwrap();
        assert_eq!(a.ops, b.ops);
    }

    #[test]
    fn parse_errors() {
        assert!(parse("").is_err());
        assert!(parse("now+1x").is_err());
        assert!(parse("now+").is_err());
        assert!(parse("now/").is_err());
    }

    #[test]
    fn resolve_now_minus_1h() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(3600 * 24);
        let result = resolve("now-1h", now).unwrap();
        let expected = now - Duration::from_secs(3600);
        assert_eq!(result, expected);
    }

    #[test]
    fn resolve_now_minus_7d() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(86400 * 30);
        let result = resolve("now-7d", now).unwrap();
        let expected = now - Duration::from_secs(86400 * 7);
        assert_eq!(result, expected);
    }

    #[test]
    fn resolve_absolute_date() {
        let now = SystemTime::now();
        let result = resolve("2024-01-01", now).unwrap();
        let epoch_secs = result
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        // 2024-01-01T00:00:00Z
        assert_eq!(epoch_secs, 1704067200);
    }

    #[test]
    fn resolve_absolute_with_time() {
        let now = SystemTime::now();
        let result = resolve("2024-01-15T10:30:00Z", now).unwrap();
        let epoch_secs = result
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        // 2024-01-15T10:30:00Z = 1705314600
        assert_eq!(epoch_secs, 1705314600);
    }

    #[test]
    fn resolve_round_to_day() {
        // 2024-06-15T12:00:00Z
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1718452800);
        let result = resolve("now/d", now).unwrap();
        let epoch_secs = result
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        // 2024-06-15T00:00:00Z
        assert_eq!(epoch_secs, 1718409600);
    }

    #[test]
    fn resolve_to_ns_works() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1000);
        let ns = resolve_to_epoch_ns("now", now).unwrap();
        assert_eq!(ns, 1_000_000_000_000);
    }

    #[test]
    fn month_arithmetic_clamps_day() {
        // 2024-01-31 + 1M should give 2024-02-29 (leap year)
        let now = SystemTime::now();
        let result = resolve("2024-01-31||+1M", now).unwrap();
        let epoch_secs = result
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        // 2024-02-29T00:00:00Z
        assert_eq!(epoch_secs, 1709164800);
    }

    #[test]
    fn round_week_monday() {
        // 2024-06-15 is a Saturday → round to Monday 2024-06-10
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1718452800); // Sat 12:00
        let result = resolve("now/w", now).unwrap();
        let epoch_secs = result
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        // 2024-06-10T00:00:00Z (Monday)
        assert_eq!(epoch_secs, 1717977600);
    }
}
