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

That release command always builds both the macOS `app` and `dmg` bundle targets so Tauri can emit the signed updater archive alongside the DMG.
It also runs the Tauri bundle step with `CI=true` so DMG generation skips Finder AppleScript setup and works reliably from the terminal.

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

For the Apple ID flow, `.env` can contain:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Everr, Inc. (TEAMID1234)"
APPLE_ID="you@example.com"
APPLE_PASSWORD="app-specific-password"
APPLE_TEAM_ID="TEAMID1234"
```

Desktop builds pass those variables through to `tauri build`.
Standalone CLI release/install commands reuse the same values when signing the downloaded CLI artifact.

To build updater artifacts for the desktop app release, also provide:

```bash
EVERR_UPDATER_PUBLIC_KEY="..."
TAURI_SIGNING_PRIVATE_KEY="..."
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
```

Generate the updater signing key with:

```bash
pnpm tauri signer generate -w ~/.tauri/everr-updater.key -p 'your-strong-password'
```

That command writes the private key to `~/.tauri/everr-updater.key` and prints the matching public key.
Use the printed public key for `EVERR_UPDATER_PUBLIC_KEY`, set `TAURI_SIGNING_PRIVATE_KEY` to the private key file contents or path-based equivalent used by your release environment, and set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the password you chose above.

Do not commit the private key, and back it up somewhere safe. If you lose it, existing installs will no longer trust future app updates signed with a different key.

The public key is embedded into the built app so it can verify `https://everr.dev/everr-app/latest.json` on startup.
The private key variables are used by `tauri build` to sign the updater archive that gets published into `packages/docs/public/everr-app/`.

You can discover the signing identity name with:

```bash
security find-identity -v -p codesigning | grep 'Developer ID Application:'
```
