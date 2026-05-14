# Shift-left telemetry routing design

## Context

The `gio/telemetry-forwarding` branch adds a public OTLP ingest pipeline to the cloud collector: any client with a valid org-scoped ingest key (`ek_…`) can send telemetry, and the cloud collector authenticates the key, derives the tenant from it, and stamps `everr.tenant.id` onto every span/log/metric before it lands in ClickHouse.

That gives us the *transport* primitive. It does not yet answer the *product* question: **which org should a dev's local telemetry land in?**

Shift-left observability assumes local-dev telemetry has real value — multiple devs hacking on the same codebase produce comparable traces, and agents (and humans) benefit from being able to look across runs. So we want this telemetry in the cloud, in a shared place. But we also don't want a dev's unrelated personal project to leak into an org's dashboard, quota, or retention budget.

This doc proposes a routing design that resolves that tension by reusing a consent primitive that already exists in the product: **the everr GitHub App install.**

## Goals

- Dev-machine telemetry from an org's codebases lands in that org's namespace, with no per-process configuration.
- Telemetry from a dev's unrelated personal projects does not leak into any org.
- A dev who is a member of multiple orgs is handled correctly without "switching context" in any UI.
- Same trust/consent boundary as the existing GitHub App install — no new claim mechanism to teach users.
- Easy escape hatch for advanced users who want to wire OTLP exporters manually.

## Non-goals

- We are not designing per-trace promotion / sharing flows ("publish this trace to the team"). That is a follow-up if needed.
- We are not redesigning the org-scoped ingest key UI shipped on this branch; it remains the manual / advanced surface.
- We are not changing the cloud collector's `everr_apikey` auth contract. Routing is a *local* concern that decides *which* key to attach.
- We are not addressing production telemetry routing. Production keeps using whatever exporters the production infra is already configured with.

## Core idea

> **A dev's local telemetry routes to org X if and only if it came from a repo on which org X has installed the everr GitHub App.**

The GitHub App install is already how orgs grant everr access to a repo for CI ingestion. Reusing it for dev-machine telemetry means:

- No new "claim a repo" UI or admin flow.
- Revocation is the same lever: uninstall the App and dev-machine telemetry for that repo stops being accepted.
- Multi-org devs need no manual context switching; routing is a property of *the code being run*, not of which org tab the dev clicked on.

## Architecture

Three components participate.

### 1. Repo-claim cache (desktop app)

The desktop app maintains a local cache of `(githubRepo → orgId, ingestKey)` records. The cloud exposes a `GET /api/cli/repo-claims` endpoint that returns the set of `{repo, orgId, key}` rows derivable from the requesting user's org memberships joined against the GitHub App installations those orgs have. The desktop app refreshes this cache:

- On login.
- Periodically (every few minutes is fine — claim list changes rarely).
- On explicit user request.

The ingest keys returned here are minted **per (user, org)** — not user-shared. That gives us per-dev audit and revocation: if a dev's machine is compromised, revoking their keys is targeted and doesn't disrupt their teammates.

### 2. Repo lookup (local collector)

The local everr collector gains a routing processor that, for each incoming span/log/metric, identifies the originating repo and the resulting org. The lookup chain is:

1. Read the resource attribute `process.working_directory` (standard OTel `process` semconv).
2. Walk parent directories until a `.git` directory is found.
3. Read the `origin` remote URL and normalize to `host/owner/repo` form.
4. Look that key up in the repo-claim cache.
5. If found: attach the corresponding ingest key on re-export to the cloud.
6. If not found: drop the telemetry (or, optionally, route to a per-user scratch namespace — see "Open questions").

The lookup is per-resource, not per-span — once a process's resource attrs are stable, the routing decision can be cached for that resource's lifetime to avoid filesystem work in the hot path.

### 3. Cloud collector: server-side repo claim check

The `everr_apikey` extension built on this branch already does the right thing once a request arrives with a Bearer key:

- Verifies the key with the app's internal endpoint.
- Derives the tenant from the key.
- Strips any client-supplied `everr.tenant.id`.
- Stamps the auth-derived tenant on the resource.

For routed dev-machine telemetry we extend this with one cross-check, which is the **load-bearing mitigation** for the threat model below:

- The local collector adds a resource attribute `everr.routed_from = "github.com/<owner>/<repo>"` describing the repo whose claim it used to pick a key.
- The cloud collector verifies that the key's org actually has the everr GitHub App installed on `<owner>/<repo>` at the time the request lands.
- On mismatch — or if `everr.routed_from` is absent on a request from a routing-issued key — the request is rejected.

This is a server-side check against the source of truth (the live GitHub App install state), not a client-side affordance. Stale caches on the desktop app cannot get past it.

## How this handles the cases

| Case | Behavior |
|------|----------|
| Org's repo, multiple devs hacking on it | All of their local runs land in the org's namespace. Agents and teammates can correlate. |
| Personal side project, no App installed | No org claims it → doesn't ship. |
| Dev in multiple orgs, repo-A from org-A, repo-B from org-B | Each routes by claim, no manual switching. |
| Contributor with a fork of an org repo | Fork remote is `github.com/<contributor>/repo`, which is unclaimed → doesn't route to upstream. (Strict default. See open questions.) |
| `node /tmp/foo.js` with no git context | No CWD match → drops or routes to personal scratch (configurable). |
| Repo present locally but App later uninstalled | Server-side claim check (live GitHub state) rejects the request, even if the desktop app's cache is stale. |
| Two orgs both install the App on the same repo | Client picks one based on cache order; server accepts either, since both claims are real. Worth a deterministic tie-break in the cache (e.g., earliest install wins) for stability rather than correctness. |
| Dev is in orgs A and B; `.git/config` accidentally points at an org-A repo while doing org-B work | Server check passes (the routing is internally coherent). Misroute lands in org A. Visible in the desktop app's routing panel; recoverable via `user_id`-scoped cleanup. See "Threat model". |

## Failure modes and degradation

- **Cache stale.** If the App was just installed and the desktop app hasn't refreshed yet, traces drop briefly. Mitigation: trigger a refresh on demand when an unmatched repo is seen.
- **Cloud unreachable.** Local exports queue and drop per the collector's normal backpressure. Routing doesn't introduce new failure modes here.
- **`process.working_directory` not set by the SDK.** This is the single most fragile assumption. See "Source of CWD" below.

## Source of CWD: SDK attribute vs PID enrichment

Two ways the routing processor can know which directory a span came from:

**(a) Resource attribute from the SDK.** The OTel semconv defines `process.working_directory`. Many SDKs don't set it by default. We can:

- Ship a thin everr SDK wrapper that adds it.
- Document it as a setup step ("export this env var").
- Accept that many spans won't route until the surrounding ecosystem catches up.

**(b) PID-based enrichment by the local collector.** Treat the local collector as a real local agent (not just an OTLP relay). It learns about new processes on the box via OS APIs, maps PID → CWD → repo, and enriches incoming spans whose `process.pid` matches.

- Reliable, no SDK changes needed.
- Couples the collector tightly to the OS (per-platform code).
- The collector becomes more than a forwarder.

The right answer is probably **(b) eventually**, **(a) to start**, since (a) works the moment we ship an SDK that sets the attribute, and (b) can be added later without changing the routing contract.

## Alternatives considered

### Manual per-app config (SDK env vars)

Each app sets `OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer ek_…` with the right org's key. Explicit, prod-shaped, no inference. **Rejected as the default** because it loses the shift-left magic ("just run your code, telemetry shows up"). Kept as the **escape hatch** for prod and exotic cases — the local collector should not overwrite an existing Authorization header on the way out.

### "Active org" toggle in the desktop app

UI affordance to pick which org all local telemetry goes to right now. **Rejected** because it requires devs to remember to switch when changing projects, and silently misroutes when they forget. Acceptable as a final fallback for processes with no repo context, but not as a primary routing input.

### Routing connector with N hand-configured exporters

Use OTel's `routing` connector with rules per resource attribute. **Rejected** because it pushes config maintenance onto users and doesn't actually decide *which key* to use — it just routes to pre-configured exporters, each of which still needs a key bolted on by hand.

### User-scoped ingest with target-org hint

Mint one user-scoped key per dev forever; let the request specify a target org via header; server validates membership. **Rejected** because:

- A leaked key potentially targets any org the user is a member of, including orgs that didn't intend to receive that user's data.
- Loses per-org audit and revocation isolation.
- Doesn't actually solve the "which org" question — still has to be answered somewhere, just on the server now instead of on the client.

### "Dev telemetry is private to the dev by default"

Treat all dev-machine telemetry as user-scoped, with explicit promotion-to-team as a separate action. **Rejected** because it inverts the product goal: we *want* teammates and agents to see each other's local runs by default, that's the value prop. A flow that requires every individual run to be promoted defeats the purpose.

## Phased rollout

**Phase 0 (this branch, already done):** Cloud collector accepts org-scoped ingest keys, isolates tenants, strips spoofable attrs. Dashboard mints keys per org. No routing yet — anyone using local-OTLP-to-cloud must manually paste a key into their collector config.

**Phase 1 (next):** Per-(user, org) key issuance + `GET /api/cli/repo-claims` endpoint. Desktop app pulls and caches the claim list at login.

**Phase 2:** Local-collector routing processor that uses `process.working_directory` from incoming resources. Document the SDK requirement in `docs/sending-telemetry.md`. Ship an everr SDK wrapper that sets the attribute.

**Phase 3:** PID-based enrichment in the local collector, removing the SDK-attribute dependency for processes spawned on the same machine as the collector.

**Phase 4 (optional):** Per-trace promotion / sharing flows, if needed.

## Open questions

1. **Unclaimed-process behavior.** Drop, or route to a per-user scratch namespace? Scratch is more forgiving (users can find their telemetry even from one-off scripts) but adds a second tenant-id shape to ClickHouse policies. Recommend: drop in Phase 1, revisit if the friction shows up in practice.

2. **Conflict resolution when two orgs claim the same repo.** Possible if a contributor is a member of both orgs and both have the App installed on a shared repo (e.g., a public OSS repo). The server check accepts either route, so this is a UX question, not a correctness question. Recommend: deterministic cache-order tie-break (e.g., earliest install wins), surfaced in the routing transparency panel so a dev can see which org is currently winning.

3. **Fork handling.** Should a fork of `github.com/<org>/repo` by a contributor route to the upstream org if the contributor is a member? Strict default says no (only the upstream remote counts); loose default says yes (treat the upstream as the canonical claim). Strict is safer for now.

4. **Process ancestry vs CWD.** A test runner spawned from `/repo-a` that spawns a subprocess in `/tmp` — does the subprocess inherit the routing? CWD-based says no; ancestry-based says yes. Ancestry is closer to user intent but requires the PID-enrichment path (Phase 3) to even be detectable.

5. **Per-(user, org) key revocation UX.** Each dev ends up with N keys, one per org they're a member of. Should the existing ingest-keys UI list these alongside manually-minted org keys, or should they live in a separate "device keys" surface? They feel different — these are auto-issued for routing, not pasted into config — so probably a separate surface.

6. **What does "agents can see other people's runs" actually look like in the UI?** Out of scope here, but the routing design assumes the dashboard supports a "team's local dev" view distinct from CI/prod. If that doesn't exist yet, Phase 1 telemetry will land somewhere with no good way to consume it.

7. **Where does the live App-install check run, and how fast?** The server-side `everr.routed_from` check is on the hot path of every public OTLP request. We need a cached lookup of `(org, repo) → installed?` with reasonable TTL, fed by GitHub webhooks for invalidation. Strawman: in-process LRU + webhook-driven invalidation, 60s positive TTL. Worth its own short design note.

## Threat model

The trust boundary this design defends is **between orgs**, not between a member and their org. An org member is already trusted by the org — they have GitHub access, can shape what CI emits, can see the org's existing telemetry, and (under this design) have an auto-issued ingest key on disk. We do not try to defend against a malicious insider; the cheaper and more realistic threats are:

1. **Accidents.** A misconfigured `.git/config`, a sibling directory mis-rooted, a process spawned with the wrong CWD, a fork that should have been treated as upstream. These produce *coherent-looking but wrong* routing decisions.
2. **Configuration drift.** A repo that was claimed by org A months ago but is no longer relevant, or whose claim moved to org B. Stale cache + live state diverge.
3. **Cross-org leak from a single dev's machine.** A member of orgs A and B running work on one while routing accidentally lands data in the other.

### What we defend rigorously

- **Routing to an org the user is not a member of.** Auto-issued keys exist only for orgs the user belongs to; no other key is available.
- **Routing to a repo that an org does not claim.** The server-side `everr.routed_from` check (Architecture §3) rejects this. Hand-crafting a `.git/config` to point at a famous-but-unrelated repo doesn't work — the user's keys are only for orgs that claim repos via the everr GitHub App.
- **Stale cache pretending a revoked install is still valid.** The server check runs against live GitHub App state, not the desktop app's cache.
- **Span attribution.** Every span carries a `user_id` resource attribute so any accidental misroute is traceable and removable post-hoc (see below).

### What we accept and mitigate via cleanup

- **Misroute within the user's own org memberships.** If a dev is in orgs A and B, both of which claim repos the dev has on disk, the dev can produce a (key, repo) pair that's coherent at the protocol level but wrong at the intent level — for example, a `.git/config` accidentally points at an org-A repo while the dev is doing work for org B. The server has no way to tell, because everything checks out.

  This is **out of scope to prevent at the protocol level**. The mitigations are:

  - **`user_id` attribution on every span.** An admin can purge a misroute with `WHERE user_id = X AND time >= …`. Cleanup is mechanical.
  - **Routing transparency in the desktop app.** A visible "recent routing decisions" panel — *not* a prompt — so a dev who's curious can see "12k spans `/work/repo-a` → Org A, 3k spans `/work/repo-b` → Org B" and notice a misroute on their own. Visible state, no interruption.

### What we explicitly do not do

- **No first-time-route confirmation prompt.** Friction the user clicks through; trains them to ignore the next, more important dialog. The threat it would address (accidents) is better served by the transparency panel and post-hoc cleanup.
- **No per-span "is this the right org" inference.** We don't try to look inside the data. Routing is decided once per resource (process), based on filesystem position, then trusted.
- **No defense against a member who *wants* to misroute their own data.** They're already trusted with the orgs' data. The accountability layer (`user_id` attribution) is enough.

### Secondary considerations

- **Per-(user, org) keys, not shared.** Compromise of one dev's machine has bounded blast radius — the keys are scoped to *that user's* memberships, not org-wide.
- **Local secret storage.** Keys live on the dev machine; the desktop app uses platform-native secret storage (keychain / secret service / DPAPI), not plaintext config.
- **Resource attrs are visible to teammates.** `process.working_directory`, `user_id`, `everr.routed_from`, and `host.name` will land in ClickHouse and be visible across the org. Worth a "what your teammates can see" doc page for devs joining the system.
- **Revocation.** Uninstalling the everr GitHub App is the org-side off-switch — server check fails after that. Removing a user from an org auto-revokes their keys.

## What this branch should preserve

To keep this design implementable as a follow-up, the current branch should avoid baking in assumptions that will get in the way:

- **Don't document "paste your ek_ key into your local collector config" as the recommended flow.** Document it as the manual escape hatch. The recommended flow is "use the desktop app, which handles routing." (Even though the desktop app doesn't handle routing yet — Phase 1.)
- **Don't make `everr_apikey` reject `cli`-config keys.** Phase 1 may want user-scoped keys for the routing-cache endpoint or as a scratch-namespace mechanism. Today the extension explicitly pins `configId: "ingest"`; that's fine for now but worth a comment that it's a transport-layer decision, not an architectural one.
- **Don't surface per-org keys in a way that implies they're meant to be hand-distributed.** The current UI is admin-only and labeled "Ingest Keys," which is fine. As Phase 1 lands, those keys will be auto-managed by the desktop app and the admin-facing UI can stay for advanced cases.

## Decision needed from the team

Before Phase 1 starts, the following should be agreed:

1. **Consent anchor.** Is the GitHub-App-install model the right anchor, or are there orgs that will want everr observability *without* installing the App (e.g., self-hosted git, gitlab)? If yes, we need an analogous claim mechanism for non-GitHub sources before Phase 1 ships broadly.
2. **Threat model.** Are we comfortable explicitly accepting "member of N orgs can produce a coherent misroute within those N orgs, mitigated by attribution + cleanup, not prevention"? This is the load-bearing premise of dropping the prompt.
3. **Phase-1 unclaimed-process default.** Drop, or scratch namespace?
4. **Server-side claim-check freshness.** Webhook-driven invalidation vs short TTL vs both. Affects how fast `App uninstall` actually stops accepting data.
5. **Per-(user, org) auto-issued key UX.** Whether and where they surface in the dashboard.
