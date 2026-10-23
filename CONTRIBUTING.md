# Contributing to Everr

## Development

Install dependencies with `pnpm install`, then run `pnpm dev`. This starts App,
Cloud, PostgreSQL, a ClickHouse container for each product, and their native
collectors. [Worktree development](docs/development.md) covers prerequisites,
Portless URLs, configuration, and shutdown.

Use Node 24, pnpm, Go 1.26, Make, Docker with Compose, and Process Compose.
For the CLI, install stable Rust and a C/C++ toolchain (Xcode command line tools
on macOS, the chDB prerequisites on Linux).

### Local email with Mailpit

```sh
pnpm dev -f process-compose.mail.yaml
```

The override starts a checkout-scoped Mailpit with Docker-assigned loopback ports
and points both apps at its SMTP listener. Open its UI using the address returned
by `docker compose -p <project> -f scripts/dev/compose.yaml port mailpit 8025`.
The project name is printed by Docker during startup. Mailpit's messages are
throwaway development data. The default `pnpm dev` uses the SMTP settings in each
application's optional dotenv file.

### GitHub webhooks and Smee

Plain `pnpm dev` starts GitHub receivers for App and Cloud and enables Smee using
each application's existing configuration. Keep the same `GITHUB_APP_*` and
`SMEE_CHANNEL` settings in `packages/app/.env` and `packages/cloud/.env`. Cloud
also loads its existing `.env.cloud` overrides. No extra profile, shell exports,
or collector configuration copy is required.

For a new GitHub App:

1. Create a channel at <https://smee.io/new> and put its id in `SMEE_CHANNEL` in
   the selected package's dotenv file.
2. Create a GitHub App in [GitHub developer settings](https://github.com/settings/apps).
   Set its webhook URL to the Smee channel URL. Give it Actions read permission
   and subscribe to Workflow job and Workflow run events.
3. Put the App ID, install URL, private key, state secret and matching webhook
   secret in the existing `GITHUB_APP_*` settings shown in that package's
   `.env.example`. Reuse configured values when they already exist.
4. Run `pnpm dev`, connect the installation from `/github`, and redeliver a
   workflow webhook to check Runs and logs.

Smee forwards to its matching application's `/webhook/github` endpoint using
Vite's actual port. Each application's worker replays signed events to its own
native GitHub receiver. Cloud keeps usage accounting and a separate durable
queue; self-hosted buffers in memory. Production collector configuration is
unchanged.

### Develop bundled skills

The public Everr skills live in `skills/`. The CLI embeds them at build time, and
`npx skills add everr-labs/everr` discovers them. Their `.agents/skills/` symlinks
and `.claude/skills` pointer use those same files during development.

```sh
npx skills add . --list
```

### Other development surfaces

Use `pnpm dev:docs` for the docs site and `pnpm dev:storybook` for Storybook.
`pnpm dev:local` starts the CLI browser UI, Rust backend, and local collector;
`pnpm dev:local:ui` starts only its Vite surface against a running development CLI.
`pnpm dev:cli` rebuilds embedded assets and the debug CLI, and `pnpm build:cli`
builds the release. The CLI version comes from `packages/cli/package.json`;
signing settings can be supplied in `packages/cli/.env`.

### Verify a change

The [verification skill](.agents/skills/verify-everr/SKILL.md) launches an isolated
`pnpm dev` graph with its own state, database project, Portless service names, and
Mailpit. It uses the same startup and collector configuration as development.

### GitHub installation ownership model

- A GitHub App `installation_id` is scoped to the install target account (user/org), not the individual user who clicks install.
- Everr enforces exclusive mapping: one `installation_id` can be linked to only one tenant.
- If another tenant tries to link the same installation, the app returns `github_install=error&reason=already_linked`.
- This prevents cross-tenant takeover of the same installation mapping.

Downsides:

- A customer cannot intentionally share one GitHub installation across multiple Everr tenants.
- If a customer accidentally creates multiple Everr orgs, they must consolidate to one org or uninstall/reinstall with a different GitHub account scope.
- Customer support may be needed to resolve mistaken links (for example, unlinking and relinking the installation).
- True cross-tenant shared views require a different data model than a single-tenant installation mapping.

Practical examples:

- Same tenant, different users:
  User A and User B both belong to the same Everr org and both click install for the same GitHub org. They resolve to the same `installation_id`, and linking succeeds (no ownership conflict).
- Different tenants, same GitHub org install:
  Tenant A links installation `12345`. Tenant B later tries to link installation `12345` and receives `github_install=error&reason=already_linked`.
- Repo selection changes:
  A user adds/removes repositories inside an existing GitHub installation. The `installation_id` does not change, so tenant ownership stays the same.
- Uninstall and reinstall:
  If the app is uninstalled and reinstalled, GitHub may create a new installation context. The new install goes through link flow again and creates/updates mapping for that new `installation_id`.
