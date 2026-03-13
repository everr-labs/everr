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

# Choose one notarization flow:
APPLE_ID="you@example.com"
APPLE_PASSWORD="app-specific-password"
APPLE_TEAM_ID="TEAMID1234"

# Or:
# APPLE_API_KEY="ABC123DEFG"
# APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
# APPLE_API_KEY_PATH="/absolute/path/to/AuthKey_ABC123DEFG.p8"
```

If you prefer importing the signing certificate from `.env` instead of relying on the login keychain, also add:

```bash
APPLE_CERTIFICATE="base64-encoded-p12"
APPLE_CERTIFICATE_PASSWORD="your-p12-password"
```

The build script no longer searches your login keychain for identities or scans local folders for App Store Connect keys. Everything must be declared explicitly in `.env`.

### Option 1: Use a locally installed Developer ID certificate

Install your `Developer ID Application` certificate in Keychain Access, then add this to the repo-root `.env`:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Everr, Inc. (TEAMID1234)"
APPLE_API_KEY="ABC123DEFG"
APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
APPLE_API_KEY_PATH="/absolute/path/to/AuthKey_ABC123DEFG.p8"
```

You can discover the identity name with:

```bash
security find-identity -v -p codesigning | grep 'Developer ID Application:'
```

### Option 2: Import the certificate from secrets

If the certificate is stored outside the local keychain, add the base64-encoded `.p12` and its password to the repo-root `.env`:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Everr, Inc. (TEAMID1234)"
APPLE_CERTIFICATE="base64-encoded-p12"
APPLE_CERTIFICATE_PASSWORD="your-p12-password"
APPLE_API_KEY="ABC123DEFG"
APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
APPLE_API_KEY_PATH="/absolute/path/to/AuthKey_ABC123DEFG.p8"
```

The build script imports the certificate into a temporary keychain. If you want to keep the App Store Connect private key in `.env` instead of on disk, `APPLE_API_PRIVATE_KEY` is also supported and will be written to a temporary file during the build.

### Notarization credentials

Use one of these notarization flows:

- `APPLE_API_KEY`, `APPLE_API_ISSUER`, and either `APPLE_API_KEY_PATH` or `APPLE_API_PRIVATE_KEY`
- `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`

### Verification

After the build, verify the DMG before publishing:

```bash
./scripts/verify-everr-app-macos.sh \
  "packages/docs/public/everr-app/macos-arm64/Everr App.dmg"
```

### Debug-only escape hatch

For local debugging only, you can bypass the signed-release checks:

```bash
export EVERR_ALLOW_UNSIGNED_MACOS_BUILD=1
```

Do not use that for anything shipped to users.
