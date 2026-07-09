//! Static SSRF validation for tenant-supplied webhook URLs.
//!
//! Tenants hand us URLs (firehose subscriptions, `webhook` receiver channels)
//! that the dispatcher later fetches from inside the deployment network. This
//! module rejects, at create time, everything that is *statically* recognizable
//! as an internal target: non-HTTP schemes, URLs with userinfo, `localhost`,
//! and IP-literal hosts in private / loopback / link-local / metadata ranges.
//!
//! What this deliberately does NOT do: resolve DNS. A resolver check at create
//! time is TOCTOU-broken (the record can change between validation and
//! dispatch, i.e. DNS rebinding), so names that resolve to internal addresses
//! must be stopped by deployment-level egress policy (network segmentation, an
//! egress proxy, or a filtering resolver on the dispatcher's network). Non-IP
//! hostnames are therefore allowed by default, which also keeps docker-compose
//! service names (e.g. `http://mailpit:8025/...`) working.
//!
//! `allow_private` (from `CC_ALLOW_PRIVATE_WEBHOOKS=1`) is the dev/compose
//! escape hatch: it skips only the private-address and localhost checks;
//! scheme, host-presence, and userinfo rules always apply.

use std::net::{Ipv4Addr, Ipv6Addr};
use url::{Host, Url};

/// Validate a tenant-supplied webhook URL. `Err` carries a human-readable
/// message suitable for a 422 problem-details `detail` field.
pub fn validate_webhook_url(raw: &str, allow_private: bool) -> Result<(), String> {
    let url = Url::parse(raw).map_err(|_| "webhook URL must be a valid absolute URL")?;

    match url.scheme() {
        "http" | "https" => {}
        other => {
            return Err(format!(
                "webhook URL scheme must be http or https (got '{other}')"
            ))
        }
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("webhook URL must not contain userinfo (user:pass@)".to_string());
    }
    let Some(host) = url.host() else {
        return Err("webhook URL must have a host".to_string());
    };

    if allow_private {
        return Ok(());
    }

    match host {
        Host::Domain(d) => {
            // The url crate already lowercases and IDNA-normalizes domains, and
            // parses every numeric form (decimal, octal, hex, dword) as Ipv4;
            // reaching Domain means the host is a real name. `localhost` and the
            // reserved `.localhost` TLD are loopback by definition.
            let d = d.strip_suffix('.').unwrap_or(d);
            if d.eq_ignore_ascii_case("localhost") || d.to_ascii_lowercase().ends_with(".localhost")
            {
                return Err("webhook URL must not target localhost".to_string());
            }
            Ok(())
        }
        Host::Ipv4(ip) => {
            if let Some(range) = blocked_v4_range(ip) {
                return Err(format!(
                    "webhook URL must not target a private or internal address ({ip} is in {range})"
                ));
            }
            Ok(())
        }
        Host::Ipv6(ip) => {
            if let Some(range) = blocked_v6_range(ip) {
                return Err(format!(
                    "webhook URL must not target a private or internal address ([{ip}] is in {range})"
                ));
            }
            Ok(())
        }
    }
}

/// The blocked IPv4 range containing `ip`, if any.
fn blocked_v4_range(ip: Ipv4Addr) -> Option<&'static str> {
    let o = ip.octets();
    if o[0] == 127 {
        Some("127.0.0.0/8 (loopback)")
    } else if o[0] == 10 {
        Some("10.0.0.0/8 (private)")
    } else if o[0] == 172 && (16..=31).contains(&o[1]) {
        Some("172.16.0.0/12 (private)")
    } else if o[0] == 192 && o[1] == 168 {
        Some("192.168.0.0/16 (private)")
    } else if o[0] == 169 && o[1] == 254 {
        Some("169.254.0.0/16 (link-local/metadata)")
    } else if o[0] == 0 {
        // "This network"; 0.0.0.0 (and on some stacks the whole /8) reaches loopback.
        Some("0.0.0.0/8 (this-network)")
    } else {
        None
    }
}

/// The blocked IPv6 range containing `ip`, if any. IPv4-mapped/compatible
/// addresses are checked against the IPv4 ranges.
fn blocked_v6_range(ip: Ipv6Addr) -> Option<&'static str> {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return blocked_v4_range(v4).map(|_| "an IPv4-mapped blocked range");
    }
    // Deprecated IPv4-compatible form (::a.b.c.d); ::1 and :: are handled below.
    if let Some(v4) = ip.to_ipv4() {
        if !ip.is_loopback() && !ip.is_unspecified() {
            return blocked_v4_range(v4).map(|_| "an IPv4-compatible blocked range");
        }
    }
    let seg0 = ip.segments()[0];
    if ip.is_loopback() {
        Some("::1 (loopback)")
    } else if ip.is_unspecified() {
        Some(":: (unspecified)")
    } else if seg0 & 0xfe00 == 0xfc00 {
        Some("fc00::/7 (unique-local)")
    } else if seg0 & 0xffc0 == 0xfe80 {
        Some("fe80::/10 (link-local)")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(u: &str) {
        assert!(
            validate_webhook_url(u, false).is_ok(),
            "{u} should be accepted: {:?}",
            validate_webhook_url(u, false)
        );
    }
    fn rejected(u: &str) -> String {
        validate_webhook_url(u, false).expect_err(&format!("{u} should be rejected"))
    }

    #[test]
    fn accepts_public_http_and_https() {
        ok("https://example.com/hook");
        ok("http://example.com:8080/hook?x=1");
        ok("https://8.8.8.8/hook");
        ok("https://[2001:db8::1]/hook"); // doc range, but not private/loopback
    }

    #[test]
    fn accepts_internal_dns_names_by_default() {
        // Compose service names and internal DNS are a deployment-level concern
        // (see module docs); only IP literals and localhost are blocked statically.
        ok("http://mailpit:8025/hook");
        ok("http://collector.internal/v1/hook");
    }

    #[test]
    fn rejects_non_http_schemes() {
        for u in [
            "ftp://example.com/x",
            "file:///etc/passwd",
            "gopher://example.com/x",
            "redis://example.com/",
            "javascript:alert(1)",
        ] {
            assert!(rejected(u).contains("scheme"), "{u}");
        }
    }

    #[test]
    fn rejects_unparseable_and_hostless() {
        rejected("not a url");
        rejected("/relative/path");
        rejected("http://");
        // Scheme-relative input is not an absolute URL.
        rejected("//example.com/hook");
    }

    #[test]
    fn rejects_userinfo() {
        assert!(rejected("http://user:pass@example.com/x").contains("userinfo"));
        assert!(rejected("http://user@example.com/x").contains("userinfo"));
    }

    #[test]
    fn rejects_localhost_names() {
        rejected("http://localhost/hook");
        rejected("http://LOCALHOST:9000/hook");
        rejected("http://localhost./hook");
        rejected("http://foo.localhost/hook");
    }

    #[test]
    fn rejects_each_private_v4_range() {
        rejected("http://10.0.0.1/x"); // 10/8
        rejected("http://10.255.255.255/x");
        rejected("http://172.16.0.1/x"); // 172.16/12
        rejected("http://172.31.255.1/x");
        rejected("http://192.168.1.1/x"); // 192.168/16
        rejected("http://127.0.0.1/x"); // 127/8
        rejected("http://127.8.9.10/x");
        rejected("http://169.254.169.254/x"); // link-local incl. cloud metadata
        rejected("http://0.0.0.0/x"); // this-network
    }

    #[test]
    fn boundary_v4_addresses_are_allowed() {
        ok("http://172.15.255.255/x"); // just below 172.16/12
        ok("http://172.32.0.1/x"); // just above 172.16/12
        ok("http://9.255.255.255/x"); // just below 10/8
        ok("http://11.0.0.1/x"); // just above 10/8
        ok("http://192.169.0.1/x"); // just above 192.168/16
        ok("http://169.253.1.1/x"); // just below 169.254/16
    }

    #[test]
    fn rejects_obfuscated_v4_literals() {
        // The url crate normalizes numeric hosts to Ipv4 before we ever see them.
        rejected("http://0x7f000001/x"); // hex 127.0.0.1
        rejected("http://017700000001/x"); // octal 127.0.0.1
        rejected("http://2130706433/x"); // dword 127.0.0.1
        rejected("http://127.1/x"); // shorthand 127.0.0.1
    }

    #[test]
    fn rejects_private_v6_forms() {
        rejected("http://[::1]/x"); // loopback
        rejected("http://[::]/x"); // unspecified
        rejected("http://[fc00::1]/x"); // unique-local fc00::/7
        rejected("http://[fd12:3456::1]/x"); // unique-local upper half
        rejected("http://[fe80::1]/x"); // link-local fe80::/10
        rejected("http://[febf::1]/x"); // link-local upper bound
        rejected("http://[::ffff:127.0.0.1]/x"); // v4-mapped loopback
        rejected("http://[::ffff:10.0.0.1]/x"); // v4-mapped private
        rejected("http://[::ffff:169.254.169.254]/x"); // v4-mapped metadata
    }

    #[test]
    fn public_v6_is_allowed() {
        ok("http://[fec0::1]/x"); // just above fe80::/10 (deprecated site-local, not blocked)
        ok("http://[fb00::1]/x"); // just below fc00::/7
        ok("http://[::ffff:8.8.8.8]/x"); // v4-mapped public
    }

    #[test]
    fn escape_hatch_allows_private_but_keeps_structural_rules() {
        // Private targets pass with the flag on (dev/compose, mailpit-style).
        assert!(validate_webhook_url("http://127.0.0.1:8025/hook", true).is_ok());
        assert!(validate_webhook_url("http://localhost:8025/hook", true).is_ok());
        assert!(validate_webhook_url("http://[::1]:8025/hook", true).is_ok());
        // Structural rules still apply.
        assert!(validate_webhook_url("ftp://127.0.0.1/hook", true).is_err());
        assert!(validate_webhook_url("http://u:p@127.0.0.1/hook", true).is_err());
        assert!(validate_webhook_url("not a url", true).is_err());
    }
}
