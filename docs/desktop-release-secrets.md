# Desktop Release Keys And Secrets

This guide sets up the secrets used by `.github/workflows/build-signed-desktop-release.yml`.
That workflow builds the macOS desktop app, signs it, notarizes it with Apple, signs the Tauri updater archive, creates checksums, creates a GitHub artifact attestation, and uploads one Actions artifact for the deploy repo to download.

## Required Apple Access

You need:

- A paid Apple Developer Program team.
- Permission to create or use a Developer ID Application certificate.
- Permission to create App Store Connect API keys.
- Admin access to this GitHub repository's Actions secrets.

Apple only allows the Apple Developer account holder to create Developer ID Application certificates. If you are not the account holder, ask them to create the certificate from your CSR or export an existing release certificate for CI.

## Create The Developer ID Certificate

Use this for code signing. It proves the app was built by our Apple developer team.

1. On a Mac, open **Keychain Access**.
2. In the menu bar, choose **Keychain Access > Certificate Assistant > Request a Certificate From a Certificate Authority**.
3. Enter your email and a clear name like `Everr Desktop Release`.
4. Choose **Saved to disk** and save the CSR file.
5. Go to Apple Developer > **Certificates, IDs & Profiles**.
6. Create a new certificate.
7. Choose **Developer ID Application**.
8. Upload the CSR and download the generated `.cer` file.
9. Double-click the `.cer` file so it appears in Keychain Access under **My Certificates**.

Check the identity name:

```bash
security find-identity -v -p codesigning | grep 'Developer ID Application'
```

It should look like:

```text
Developer ID Application: Everr, Inc. (TEAMID1234)
```

## Export The Certificate For CI

1. In Keychain Access, open **My Certificates**.
2. Expand the **Developer ID Application** certificate.
3. Select the private key under it.
4. Right-click and choose **Export**.
5. Save it as `everr-developer-id.p12`.
6. Use a strong export password. This becomes `APPLE_CERTIFICATE_PASSWORD`.

Convert the `.p12` file to one-line base64:

```bash
openssl base64 -A -in everr-developer-id.p12 -out everr-developer-id.p12.base64
```

Create these GitHub repository secrets:

- `APPLE_CERTIFICATE`: the full contents of `everr-developer-id.p12.base64`
- `APPLE_CERTIFICATE_PASSWORD`: the `.p12` export password
- `APPLE_KEYCHAIN_PASSWORD`: a new random password used only for the temporary CI keychain

## Create The App Store Connect API Key

Use this for notarization. Notarization is Apple's malware scan and approval step for apps distributed outside the Mac App Store.

1. Go to App Store Connect > **Users and Access**.
2. Open the **Integrations** tab.
3. Create a new API key.
4. Give it a clear name like `Everr Desktop Notarization`.
5. Choose **Developer** access.
6. Copy the **Issuer ID** shown above the keys table.
7. Copy the key's **Key ID**.
8. Download the `.p8` private key. Apple only lets you download it once.

Create these GitHub repository secrets:

- `APPLE_API_ISSUER`: the Issuer ID
- `APPLE_API_KEY_ID`: the Key ID
- `APPLE_API_PRIVATE_KEY`: the full contents of the downloaded `.p8` file

The workflow writes the `.p8` file to a temporary path and passes these to Tauri as `APPLE_API_ISSUER`, `APPLE_API_KEY`, and `APPLE_API_KEY_PATH`.

## Create The Tauri Updater Key

Use this for update archive signing. This is separate from Apple's certificate.

From `packages/desktop-app`, run:

```bash
pnpm tauri signer generate -w ~/.tauri/everr-updater.key -p 'use-a-strong-password'
```

The command writes a private key to `~/.tauri/everr-updater.key` and prints a public key.

Create these GitHub repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `~/.tauri/everr-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password you used when generating the key

Make sure the printed public key matches `plugins.updater.pubkey` in `packages/desktop-app/src-tauri/tauri.conf.json`.

Keep the private key backed up somewhere safe. If it is lost, existing installs will not trust updates signed with a new key.

## Run The Workflow

Workflow: **Build Signed Desktop Release**

It runs automatically on pushes to `main`. You can also run it manually from GitHub Actions. CI uses the commit SHA as the release identity and generates the numeric Tauri/macOS updater version from the checked-in development version plus the workflow run number.

The uploaded artifact is named:

```text
everr-desktop-release-<git-sha>
```

It contains:

```text
everr
everr.sha256
SHA256SUMS
release-metadata.json
everr-app/latest.json
everr-app/everr-macos-arm64.dmg
everr-app/everr-macos-arm64.app.tar.gz
everr-app/everr-macos-arm64.app.tar.gz.sig
```

## Pull From The Deploy Repo

The deploy repo can download the artifact by workflow run ID.

Using the GitHub CLI:

```bash
gh run download <run-id> \
  --repo everr-labs/everr \
  --name everr-desktop-release-<git-sha> \
  --dir ./desktop-release
```

Using `actions/download-artifact` in the deploy repo:

```yaml
- name: Download desktop release artifact
  uses: actions/download-artifact@v4
  with:
    github-token: ${{ secrets.EVERR_SOURCE_REPO_TOKEN }}
    repository: everr-labs/everr
    run-id: ${{ inputs.source_run_id }}
    name: everr-desktop-release-${{ inputs.source_sha }}
    path: ./desktop-release
```

`EVERR_SOURCE_REPO_TOKEN` needs read access to this repo's Actions artifacts.

## Verify Before Publishing

After downloading:

```bash
cd desktop-release
shasum -a 256 -c SHA256SUMS
```

Verify the GitHub artifact attestation:

```bash
gh attestation verify everr-app/everr-macos-arm64.dmg --repo everr-labs/everr
gh attestation verify everr-app/everr-macos-arm64.app.tar.gz --repo everr-labs/everr
```

On a Mac, you can also check the Apple notarization ticket:

```bash
xcrun stapler validate everr-app/everr-macos-arm64.dmg
spctl --assess --type open --verbose everr-app/everr-macos-arm64.dmg
```

## Troubleshooting

- **No Developer ID Application identity found**: the `.p12` probably did not include the private key, or the wrong certificate type was exported.
- **Tauri cannot notarize**: check `APPLE_API_ISSUER`, `APPLE_API_KEY_ID`, and `APPLE_API_PRIVATE_KEY`.
- **Missing updater signature**: check `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- **Updater does not trust the build**: the public key in `tauri.conf.json` does not match the private key in GitHub secrets.
- **Deploy repo cannot download the artifact**: the token used in the deploy repo needs permission to read Actions artifacts from `everr-labs/everr`.

References:

- [Blacksmith runner labels](https://docs.blacksmith.sh/introduction/quickstart)
- [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri updater signing](https://v2.tauri.app/plugin/updater/)
- [GitHub artifact attestations](https://github.com/actions/attest)
