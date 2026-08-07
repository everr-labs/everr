# npm Release Secrets

This guide sets up the GitHub Actions secrets used by `.github/workflows/release-pr.yml` to publish this repository's public npm packages during a Changesets release: `@everr/otel-errors` and `@everr/otel-web`.

## Required Access

You need:

- Admin access to this GitHub repository's Actions secrets.
- Owner or admin access to the `@everr` npm organization.
- Access to the `everr-deploy` GitHub App credentials used by release automation.

## Create The npm Publish Token

Create an npm access token that can publish under the `@everr` scope. One token covers both packages; `scripts/publish-packages.mjs` publishes each one that is not already on the registry at its current version.

Use an automation or granular token that is valid for CI publishing. If the npm organization requires two-factor authentication for writes, use a token type that npm allows for automated publishing without an interactive one-time password prompt.

Create this GitHub repository secret:

- `NPM_TOKEN`: the npm token with publish access for the `@everr` scope

The workflow passes this secret to `actions/setup-node` as `NODE_AUTH_TOKEN`. You do not need to create a separate `NODE_AUTH_TOKEN` secret.

## Check The GitHub App Secrets

The release workflow also needs the deploy GitHub App token so Changesets can open version PRs and push release tags.

Create or confirm these GitHub repository secrets:

- `EVERR_DEPLOY_BOT_APP_ID`: the GitHub App ID.
- `EVERR_DEPLOY_BOT_PRIVATE_KEY`: the full private key for the GitHub App.

The GitHub App must be installed on `everr-labs/everr` and needs enough repository access to create pull requests, push commits to the release branch, and push tags.

## Run A Release

Add a changeset for each package that needs a new npm version:

```bash
pnpm changeset
```

After the changeset lands on `main`, the release workflow opens or updates the Version Packages PR. Merge that PR when the generated versions and changelogs are correct.

On the next `main` run, the same workflow:

1. Builds each package in `scripts/publish-packages.mjs`, in dependency order.
2. Publishes each one to npm if the checked-in version is not already published.
3. Creates the Changesets release tags.

## Troubleshooting

- **npm returns 401 or 403**: check that `NPM_TOKEN` exists in this repository and has publish access to the `@everr` scope.
- **npm asks for a one-time password**: replace the token with one that supports CI publishing for an organization with two-factor authentication enabled.
- **A package is already published**: the release script skips npm publish for that version, moves on to the next package, and still lets Changesets create missing tags.
- **The Version Packages PR is not created**: check `EVERR_DEPLOY_BOT_APP_ID`, `EVERR_DEPLOY_BOT_PRIVATE_KEY`, and the GitHub App repository permissions.
