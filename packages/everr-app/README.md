# Everr App

## Development

Start the desktop app from the repo root:

```bash
pnpm dev:desktop
```

Or from this package directly:

```bash
pnpm dev
```

## Signed macOS release

The production release entrypoint is:

```bash
pnpm build:desktop:prod
```

That command runs the repo-root `scripts/build-everr-app.sh`, which now loads Apple signing and notarization credentials from the repo-root `.env`.

Add the required values to the repo-root `.env`:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Everr, Inc. (TEAMID1234)"
APPLE_ID="you@example.com"
APPLE_PASSWORD="app-specific-password"
APPLE_TEAM_ID="TEAMID1234"
```

The build script no longer searches your login keychain for identities or scans local folders for notarization credentials. Everything must be declared explicitly in `.env`.

When you run the build script, it exports those values before invoking Tauri. If you want to run the Tauri command manually, use the same export behavior:

```bash
set -a
source .env
set +a
cd packages/everr-app
pnpm tauri build
```

### Option 1: Use a locally installed Developer ID certificate

Install your `Developer ID Application` certificate in Keychain Access, then add this to the repo-root `.env`:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Everr, Inc. (TEAMID1234)"
APPLE_ID="you@example.com"
APPLE_PASSWORD="app-specific-password"
APPLE_TEAM_ID="TEAMID1234"
```

You can discover the identity name with:

```bash
security find-identity -v -p codesigning | grep 'Developer ID Application:'
```

### Notarization credentials

This build path supports only the Apple ID notarization flow:

- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

### Verification

After the build, verify the DMG before publishing:

```bash
./scripts/verify-everr-app-macos.sh \
  packages/docs/public/everr-app/everr-app-macos-arm64.dmg
```

### Debug-only escape hatch

For local debugging only, you can bypass the signed-release checks:

```bash
export EVERR_ALLOW_UNSIGNED_MACOS_BUILD=1
```

Do not use that for anything shipped to users.
