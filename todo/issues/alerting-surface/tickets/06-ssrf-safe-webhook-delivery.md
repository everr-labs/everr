# 6: SSRF-safe webhook delivery

**What to build:** A hostname that resolves publicly during validation and
internally during connection can no longer reach internal services.
**Decided 2026-08-16: the enforcement point is the network, not the
application.** The delivery worker runs with restricted egress, and
self-hosted operators are told to do the same. The application keeps the
guard it has and does not grow a pinned-address dialer.

## What the application already does

The evidence this ticket was filed with is stale. It cited
`channel-sender.server.ts:54` and `:133`; that file is now 43 lines and
does nothing but dispatch on channel type. The refactor that gave each
channel type its whole send moved the guard into
`packages/app/src/data/alerting/delivery/providers/outbound.ts`, where
`validateOutboundUrl` enforces, for every user-supplied destination:

- http or https only, and no userinfo in the URL.
- No `localhost` or `*.localhost`.
- A literal IP is checked against IPv4 and IPv6 blocklists: loopback,
  private ranges, carrier-grade NAT, link-local (so the cloud metadata
  endpoint at 169.254.169.254 is covered), documentation ranges and
  multicast.
- A name is resolved with `all: true` and rejected if **any** returned
  address is blocked, not merely the first.

Both senders that post to a channel-supplied URL then use
`redirect: "error"` and a send timeout, so a 302 into the internal network
is refused rather than followed. `webhook` and `discord` go through
`postJson`; `slack` builds its own request because Slack will not accept
the plain body, and calls the same guard first (`providers/slack.ts:23`).
`telegram` posts to `api.telegram.org` with no user input in the host, and
says so in place.

## What is left, and why it is accepted

One gap: the resolution at `outbound.ts:135` and the connection at
`outbound.ts:152` (and `slack.ts:45`) are separate lookups. A name that
answers publicly for the first and internally for the second is not caught.
That is the whole of the remaining exposure. It needs an attacker who can
both create a channel and control a DNS server with a short TTL.

The "Test channel" button makes that window reachable on demand instead of
on the next alert, and answers with a status code and a latency. The response
body no longer comes back with it (`ChannelSendError` keeps the endpoint's
answer in a field the test never reads), so the window is an oracle, not a
reader. Nothing rate-limits the button and nothing accounts the sends to an
organization: `testChannel`'s `_organizationId` argument is unused. Both
belong to ticket 05's authorization work, and neither changes the decision
here, because egress control closes the window itself.

Closing it in the application means connecting to the address already
validated: `validateOutboundUrl` returning its resolved list, and both
senders sharing a dispatcher whose `connect.lookup` replays that list.
Roughly 60 lines and a new direct dependency on `undici` for the `Agent`,
because `fetch` takes a dispatcher and nothing else will do it without
losing `fetch` (and with it the integration harness, which captures every
send by stubbing `globalThis.fetch`).

That work is not being done, for two reasons.

**The reference implementation is weaker than what we already ship.**
Grafana's alerting webhooks reach `pkg/services/notifications/webhook.go`,
which parses the URL, builds the request, and hands it to a plain
`http.Client` over a bare `net.Dialer`. No scheme check, no blocklist, no
resolution, nothing to rebind against. Its notifier
(`receivers/webhook/v1/webhook.go` in `grafana/alerting`) runs the URL
through the template engine first, which widens the input rather than
narrowing it. The only protection in that file is `url.Redacted()` in the
log and error paths, which is credential hygiene, not SSRF. Contact points
there are editable by Editor and above, not Admin only. So the industry
answer for self-hosted alerting is not a pinned dialer; it is a trusted
config author plus network egress control.

**The enforcement point should not be per-call-site.** A dialer that pins
one address protects the two senders that use it and nothing else. Every
future outbound feature has to remember. Egress control covers the whole
process, including code not written yet, and it is the control Grafana
Cloud relies on.

## What has to be true before the release

- [ ] The delivery worker's egress denies RFC 1918, loopback, link-local
      (including 169.254.169.254), carrier-grade NAT and IPv6 unique-local
      destinations, by NetworkPolicy or an egress proxy
- [ ] The rule is verified from inside the running worker, not only in the
      manifest: a channel pointed at an internal address fails to connect
- [ ] Self-hosted operators are told the same requirement, in the deployment
      docs, next to whatever else the worker needs
- [ ] The accepted residual risk is stated where a deployer will read it: an
      operator who ignores the guidance is exposed to the rebinding gap
      above, and any organization member can create the channel that uses
      it, and test it on demand, while ticket 05 is open

## What would reopen the application fix

The pinned-address work comes back if any of these becomes true. It is
scoped above, so picking it up needs no rediscovery.

- Egress control cannot be relied on for a deployment we ship to (a
  customer-run install where we cannot verify it, for example).
- A second outbound path appears that does not go through
  `providers/outbound.ts`, which would make the network the only control
  covering both.
- The product goes hosted multi-tenant with organizations that do not trust
  each other. The precedent there is not Grafana core: it is Grafana OnCall,
  whose webhook SSRF became CVE-2024-5526 (CVSS 7.7) precisely because a
  hosted product cannot assume the config author is trusted.

**Blocked by:** None. The work is deployment configuration and
documentation, not application code.

**Status:** ready-for-agent (network and docs), application fix declined
2026-08-16
