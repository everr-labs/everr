# Desktop App

## Development

Start the desktop app from this package:

```bash
pnpm dev
```

Build the packaged desktop app from this package:

```bash
pnpm build:desktop
```

Build the standalone CLI from the same package:

```bash
pnpm build:cli:release
pnpm install:cli:release
```

## Native env

Native commands in this package automatically source `./.env` before invoking Tauri or CLI release/install scripts.
If the file is missing, the scripts continue without it.

## macOS signing and notarization

For the Apple ID flow, `.env` can contain:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Everr, Inc. (TEAMID1234)"
APPLE_ID="you@example.com"
APPLE_PASSWORD="app-specific-password"
APPLE_TEAM_ID="TEAMID1234"
```

Desktop builds pass those variables through to `tauri build`.
Standalone CLI release/install commands reuse the same values when signing the downloaded CLI artifact.

You can discover the signing identity name with:

```bash
security find-identity -v -p codesigning | grep 'Developer ID Application:'
```
