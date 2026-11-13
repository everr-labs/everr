# Homebrew and download domain plan

Status: proposed

## Goal and scope

Make the Everr CLI installable and upgradeable through Homebrew on Apple Silicon. Serve permanent release files from `get.everr.dev` using the existing Scaleway Object Storage bucket and Scaleway Edge Services. Preserve the current installer and updater URLs for existing users.

The first Homebrew package covers the CLI. A Homebrew cask for the desktop app and support for Intel macOS are separate follow-ups.

## Current state

- The source repository builds a signed macOS arm64 CLI, a signed and notarized desktop app, and Linux arm64 and x86_64 CLIs in [the release workflow](../.github/workflows/deploy-desktop-app.yml).
- The source workflow sends a release artifact to [the deployment repository](https://github.com/everr-labs/everr-deploy). Its deployment workflow verifies checksums and attestations, then uploads files to the existing `everr-dev-desktop-release-artifacts` bucket in Scaleway's `fr-par` region.
- The bucket policy grants public read access to `everr-app/*`. The documentation app redirects allowed `https://everr.dev/everr-app/*` paths to the bucket. See [the redirect code](../packages/docs/src/lib/desktop-release-redirect.ts).
- Release paths such as `everr-app/everr` and `everr-app/everr-macos-arm64.dmg` are overwritten on each release. The CLI installer, GitHub Action, CLI updater, and desktop updater use these moving paths.
- `everr upgrade` replaces its own executable. That would conflict with Homebrew's ownership of an installed binary.

## Decisions

1. Reuse the existing bucket. Place permanent files under `everr-app/releases/<version>/` so the current public read policy covers them.
2. Use one Scaleway Edge Services pipeline for the bucket and attach `get.everr.dev` with a managed TLS certificate. Manage the pipeline and DNS in the deployment repository's Terraform configuration.
3. Retain the existing `everr.dev/everr-app/*` paths as compatibility aliases. Do not change installed clients' download endpoints during the initial rollout.
4. Publish a signed macOS arm64 CLI inside a checksummed `.tar.gz` archive. Package it in an Everr maintained Homebrew tap as an `everr-cli` cask. The cask installs the executable as `everr`.
5. Update the tap only after the new release files are publicly downloadable and verified.

Example permanent files for version `0.8.3`:

```text
https://get.everr.dev/everr-app/releases/0.8.3/everr-darwin-arm64.tar.gz
https://get.everr.dev/everr-app/releases/0.8.3/everr-macos-arm64.dmg
https://get.everr.dev/everr-app/releases/0.8.3/everr-macos-arm64.app.tar.gz
https://get.everr.dev/everr-app/releases/0.8.3/everr-macos-arm64.app.tar.gz.sig
```

## Implementation

### 1. Configure the download domain

In `everr-labs/everr-deploy`, add an Edge Services pipeline with the existing bucket as its S3 backend, a cache stage, a managed certificate TLS stage, and a DNS stage for `get.everr.dev`. Add the required Cloudflare CNAME as DNS only, so traffic terminates at Scaleway Edge Services. Provision the pipeline and DNS in an order that allows certificate issuance to complete.

Keep the bucket's public read policy scoped to `everr-app/*`. Verify an existing file through `https://get.everr.dev/everr-app/...` with HTTPS, `HEAD`, a full `GET`, and a byte-range request before referring to the new domain in any release metadata.

### 2. Prepare permanent release artifacts

In [the source release workflow](../.github/workflows/deploy-desktop-app.yml), archive the already signed macOS CLI after the build. Include the archive in the combined release payload before generating `SHA256SUMS` and the file list in `release-metadata.json`. Verify its checksum and artifact attestation alongside the existing files.

Use the desktop package version as the release path version. Verify that the CLI's reported version, package version, and release metadata version agree. Do not infer the public version from the `everr-cli` Cargo package version, which currently differs from the desktop release version.

In the deployment workflow, upload the signed CLI archive, DMG, updater archive, signature, and any other permanent release files to `everr-app/releases/<version>/`. A repeated deployment may reuse an existing object only when its recorded SHA-256 matches the release payload. Fail if a versioned path contains different bytes.

Set long-lived `Cache-Control` on permanent files, for example `public, max-age=31536000, immutable`. Keep `no-cache, max-age=0, must-revalidate` on moving files, checksums, and manifests. Verify the permanent public downloads against the release checksums before publishing moving aliases.

### 3. Publish updater metadata safely

Make the new release's `latest.json` refer to the permanent updater archive at `get.everr.dev`. Keep `latest.json` itself at its current `everr.dev/everr-app/latest.json` path so installed apps can find it. Its signature still authenticates the downloaded updater archive.

Upload the permanent files first, then their verified moving aliases, and publish `latest.json` last. Keep `release-metadata.json` at its current path for installed CLIs. The CLI upgrade path can continue to use the moving CLI binary until Homebrew ownership handling is in place.

### 4. Make CLI maintenance package aware

Update `everr upgrade` so a Homebrew-managed installation never replaces the executable in Homebrew's Caskroom. It should tell the user to run `brew upgrade --cask everr-cli`. If the desktop app is installed, decide explicitly whether the same command should still update that app; the CLI must remain under Homebrew control either way.

Update the periodic update notice to show the Brew command for Brew installations and `everr upgrade` for direct installs. Update `everr uninstall` to print the corresponding Brew uninstall command instead of an `rm` command. Cover direct installs, Brew installs, and an installed desktop app in the relevant CLI tests.

### 5. Create and maintain the Homebrew tap

Create a public `everr-labs/homebrew-tap` repository with `Casks/everr-cli.rb`. The cask should pin a concrete version, the permanent archive URL, and its SHA-256, declare macOS arm64 support, and link the archived `everr` executable. Installation should not run the interactive `everr setup` flow automatically.

The user-facing install command will be:

```sh
brew install --cask everr-labs/tap/everr-cli
```

After a successful release deployment, prepare a tap update with the new version and checksum. Verify the URL and checksum before publishing the tap change. Document `brew upgrade --cask everr-cli` and `brew uninstall --cask everr-cli` alongside the existing `install.sh` path.

### 6. Validate before announcing

- Check certificate validity, full downloads, byte-range downloads, content types, and cache headers at `get.everr.dev`.
- Check that each permanent URL returns the expected SHA-256 and cannot silently change on a repeated deployment.
- Verify Apple code signing and notarization for the downloaded DMG and CLI, plus the updater archive signature.
- Confirm the old `everr.dev/everr-app/*` URLs and `install.sh` still work.
- Install the cask on a clean Apple Silicon machine, then run `everr --version`, `everr --help`, and a local collector smoke check.
- Exercise `brew upgrade` and `brew uninstall`. Confirm that `everr upgrade` does not modify the Brew-managed executable.
- Update an older installed desktop app through its existing `latest.json` URL and confirm it downloads the permanent signed archive.

## Rollout and recovery

1. Provision and validate the Edge Services domain while all existing URLs remain in use.
2. Add and validate permanent release uploads while still publishing the old paths.
3. Publish updater metadata that references permanent archives.
4. Release the Brew-aware CLI, then publish and test the tap cask.
5. Add the Homebrew option to the installation documentation.

If the new domain or tap has a problem, stop publishing the tap update and keep users on the existing `everr.dev` URLs. Restore the previous `latest.json` if updater downloads fail. Do not delete a permanent release path that a published cask or updater manifest references.

## Cost and effort

Scaleway Edge Services Starter is currently €0.99 per month before tax for one pipeline and 100 GB per month of cached traffic. Additional cached traffic is €0.0135 per GB. The managed Let's Encrypt certificate is included. Existing Object Storage charges remain separate. Confirm the account's current plan and prices before provisioning.

Estimate 2 to 3 engineering days for the domain, release workflow, Brew-aware CLI, tap, and end-to-end validation. DNS and certificate provisioning may add elapsed time.

## References

- [Scaleway Edge Services for Object Storage](https://www.scaleway.com/en/docs/object-storage/how-to/get-started-edge-services/)
- [Scaleway cache behavior](https://www.scaleway.com/en/docs/edge-services/how-to/configure-cache/)
- [Scaleway Edge Services pricing](https://www.scaleway.com/en/pricing/network/)
- [Homebrew cask guide](https://docs.brew.sh/Cask-Cookbook)
- [Homebrew tap guide](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
