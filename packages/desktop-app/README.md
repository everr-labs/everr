# Desktop App

## Development

Start the desktop app from this package:

```bash
pnpm dev
```

`pnpm dev` launches the app as `Everr_Dev`.

Build the packaged desktop app from this package:

```bash
pnpm build:desktop
```

That release command always builds both the macOS `app` and `dmg` bundle targets so Tauri can emit the signed updater archive alongside the DMG.
It also runs the Tauri bundle step with `CI=true` so DMG generation skips Finder AppleScript setup and works reliably from the terminal.
It stages the release DMG, updater archive, updater signature, `latest.json`, release metadata, checksums, and signed CLI files into `target/desktop-release/`.

CI uses the same release path through:

```bash
pnpm build:desktop:ci
```

To bump the desktop app version by one patch before building the release, use:

```bash
pnpm build:desktop -- --release
```

That updates the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` before the build starts.

Install the signed release CLI into `~/.local/bin` only when you explicitly opt in:

```bash
pnpm build:desktop -- --install
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

For local signed builds, `.env` can contain:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Everr, Inc. (TEAMID1234)"
APPLE_API_ISSUER="issuer-uuid"
APPLE_API_KEY="key-id"
APPLE_API_KEY_PATH="/absolute/path/to/AuthKey_KEYID.p8"
```

Desktop builds pass those variables through to `tauri build`.
Standalone CLI release/install commands reuse `APPLE_SIGNING_IDENTITY` when signing the downloaded CLI artifact.

To sign updater artifacts for the desktop app release, provide:

```bash
TAURI_SIGNING_PRIVATE_KEY="..."
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
```

Generate the updater signing key with:

```bash
pnpm tauri signer generate -w ~/.tauri/everr-updater.key -p 'your-strong-password'
```

That command writes the private key to `~/.tauri/everr-updater.key` and prints the matching public key.
Set `TAURI_SIGNING_PRIVATE_KEY` to the private key file path or contents used by your release environment, and set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the password you chose above.
The printed public key must match the value configured in `src-tauri/tauri.conf.json`.

Do not commit the private key, and back it up somewhere safe. If you lose it, existing installs will no longer trust future app updates signed with a different key.

The public key is embedded into the built app from `src-tauri/tauri.conf.json` so it can verify `https://everr.dev/everr-app/latest.json` on startup.
The private key variables are used by `tauri build` to sign the updater archive staged into `target/desktop-release/everr-app/`.

CI signing and secret setup are documented in [`../../docs/desktop-release-secrets.md`](../../docs/desktop-release-secrets.md).
CI uses the `Build Signed Desktop Release` workflow, runs on a Blacksmith macOS runner, and uploads the staged `target/desktop-release/` folder as a GitHub Actions artifact for the deploy repository.

You can discover the signing identity name with:

```bash
security find-identity -v -p codesigning | grep 'Developer ID Application:'
```
