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

That command runs the repo-root `scripts/build-everr-app.sh`, which now expects a valid Apple signing identity and notarization credentials for distributable macOS builds.

### Option 1: Use a locally installed Developer ID certificate

Install your `Developer ID Application` certificate in Keychain Access, then export:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Everr, Inc. (TEAMID1234)"
export APPLE_API_KEY="ABC123DEFG"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_ABC123DEFG.p8"
pnpm build:desktop:prod
```

You can discover the identity name with:

```bash
security find-identity -v -p codesigning | grep 'Developer ID Application:'
```

### Option 2: Import the certificate from secrets

If the certificate is stored outside the local keychain, provide the base64-encoded `.p12` and its password:

```bash
export APPLE_CERTIFICATE="$(openssl base64 -A -in EverrDeveloperID.p12)"
export APPLE_CERTIFICATE_PASSWORD="your-p12-password"
export APPLE_API_KEY="ABC123DEFG"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
export APPLE_API_PRIVATE_KEY="$(cat AuthKey_ABC123DEFG.p8)"
pnpm build:desktop:prod
```

The build script imports the certificate into a temporary keychain, infers `APPLE_SIGNING_IDENTITY` if needed, writes the App Store Connect key to a temporary file when `APPLE_API_PRIVATE_KEY` is used, and removes those temporary artifacts when the build exits.

### Notarization credentials

Use one of these notarization flows:

- `APPLE_API_KEY`, `APPLE_API_ISSUER`, and either `APPLE_API_KEY_PATH` or `APPLE_API_PRIVATE_KEY`
- `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`

If `APPLE_API_KEY_PATH` is not set, the build script will also look in:

- `./private_keys/AuthKey_<APPLE_API_KEY>.p8`
- `~/private_keys/AuthKey_<APPLE_API_KEY>.p8`
- `~/.private_keys/AuthKey_<APPLE_API_KEY>.p8`
- `~/.appstoreconnect/private_keys/AuthKey_<APPLE_API_KEY>.p8`
- `$API_PRIVATE_KEYS_DIR/AuthKey_<APPLE_API_KEY>.p8`

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
