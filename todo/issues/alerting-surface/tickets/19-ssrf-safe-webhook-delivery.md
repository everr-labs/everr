# 19: SSRF-safe webhook delivery

**What to build:** A hostname that resolves publicly during validation and
internally during connection can no longer reach internal services.
Delivery connects to the validated address, for every sender kind.

**Evidence:** `packages/app/src/data/alerting/delivery/channel-sender.server.ts:54`
resolves the hostname during validation, and `fetch` or the Slack sender
resolves it again on connection. A hostname can answer with a public
address for the first lookup and an internal address for the second.

**Blocked by:** None. Deferred out of the merge gate as a non-blocker
(2026-08-09): the pinned-address or proxy fix is complex, and the risk is
accepted for now. Stated risk until this lands: an authenticated member
(authorization is also deferred, ticket 18) can point a channel at an
attacker-controlled DNS name and use the delivery worker to probe the
deployment's internal network.

**Status:** deferred

- [ ] Connections use the validated address with the correct TLS server name, or an enforcing outbound proxy
- [ ] Applied to generic webhook, Slack, and Discord delivery
- [ ] DNS rebinding and redirect tests
