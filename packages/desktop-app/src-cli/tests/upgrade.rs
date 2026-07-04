mod support;

use predicates::str::contains;
use sha2::{Digest, Sha256};
use support::{CliTestEnv, mock_api_server};

const DOWNLOAD_BASE_URL_ENV: &str = "EVERR_DOWNLOAD_BASE_URL_FOR_TESTS";

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[test]
fn upgrade_is_a_noop_when_already_up_to_date() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();
    let metadata = server
        .mock("GET", "/everr-app/release-metadata.json")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(format!(r#"{{"version":"{}"}}"#, env!("EVERR_VERSION")))
        .expect(1)
        .create();

    env.command_with_release_metadata_url(&format!(
        "{}/everr-app/release-metadata.json",
        server.url()
    ))
    .arg("upgrade")
    .assert()
    .success()
    .stdout(contains("Already up to date"));

    metadata.assert();
}

/// The app-update path is exercised through the debug-only install path
/// override, so these tests run on every platform: the CLI half of the
/// upgrade is a no-op because the metadata reports the current CLI version.
/// Debug-only: in a release build the overrides are compiled out, and on a
/// macOS machine `installed_app_path` would find the real /Applications
/// install instead of the harness fixture.
#[cfg(debug_assertions)]
mod app_upgrade {
    use std::fs;
    use std::path::{Path, PathBuf};

    use assert_cmd::Command;
    use base64::Engine;
    use minisign::KeyPair;
    use predicates::str::contains;

    use crate::support::{CliTestEnv, mock_api_server};
    use crate::{DOWNLOAD_BASE_URL_ENV, sha256_hex};

    const APP_INSTALL_PATH_ENV: &str = "EVERR_APP_INSTALL_PATH_FOR_TESTS";
    const UPDATER_PUBKEY_ENV: &str = "EVERR_UPDATER_PUBKEY_FOR_TESTS";
    const ARCHIVE_NAME: &str = "everr-macos-arm64.app.tar.gz";

    struct AppUpgradeHarness {
        env: CliTestEnv,
        server: mockito::ServerGuard,
        keypair: KeyPair,
        _install_dir: tempfile::TempDir,
        installed_app: PathBuf,
    }

    impl AppUpgradeHarness {
        fn new(installed_version: &str, latest_app_version: &str, archive_sha256: &str) -> Self {
            let env = CliTestEnv::new();
            let mut server = mock_api_server();
            server
                .mock("GET", "/everr-app/release-metadata.json")
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(
                    serde_json::json!({
                        "version": env!("EVERR_VERSION"),
                        "platform_version": latest_app_version,
                        "target": { "updaterArchiveName": ARCHIVE_NAME },
                        "files": [
                            { "path": format!("everr-app/{ARCHIVE_NAME}"), "sha256": archive_sha256 },
                        ],
                    })
                    .to_string(),
                )
                .create();

            let install_dir = tempfile::tempdir().expect("install dir");
            let installed_app =
                write_fake_app(install_dir.path(), installed_version, "old-app-binary");
            let keypair = KeyPair::generate_unencrypted_keypair().expect("generate keypair");

            Self {
                env,
                server,
                keypair,
                _install_dir: install_dir,
                installed_app,
            }
        }

        fn mock_archive(&mut self, archive: &[u8]) {
            self.mock_archive_with_signature(archive, archive);
        }

        /// Serves `archive` with a signature computed over `signed_bytes`, so
        /// tests can publish a signature that does not match the archive. The
        /// .sig body is base64 over the minisign signature file, matching the
        /// Tauri release artifacts.
        fn mock_archive_with_signature(&mut self, archive: &[u8], signed_bytes: &[u8]) {
            let signature_file = minisign::sign(
                Some(&self.keypair.pk),
                &self.keypair.sk,
                std::io::Cursor::new(signed_bytes),
                None,
                None,
            )
            .expect("sign archive")
            .into_string();
            let signature = base64::engine::general_purpose::STANDARD.encode(signature_file);
            self.server
                .mock("GET", format!("/everr-app/{ARCHIVE_NAME}").as_str())
                .with_status(200)
                .with_body(archive)
                .create();
            self.server
                .mock("GET", format!("/everr-app/{ARCHIVE_NAME}.sig").as_str())
                .with_status(200)
                .with_body(signature)
                .create();
        }

        /// The pubkey override value: base64 over the minisign .pub file
        /// content, the same encoding tauri.conf.json uses.
        fn pubkey_override(&self) -> String {
            let pubkey_file = self
                .keypair
                .pk
                .to_box()
                .expect("box public key")
                .into_string();
            base64::engine::general_purpose::STANDARD.encode(pubkey_file)
        }

        fn upgrade_command(&self) -> Command {
            let mut cmd = self.env.command_with_release_metadata_url(&format!(
                "{}/everr-app/release-metadata.json",
                self.server.url()
            ));
            cmd.env(
                DOWNLOAD_BASE_URL_ENV,
                format!("{}/everr-app", self.server.url()),
            );
            cmd.env(APP_INSTALL_PATH_ENV, &self.installed_app);
            cmd.env(UPDATER_PUBKEY_ENV, self.pubkey_override());
            cmd.arg("upgrade");
            cmd
        }

        fn installed_marker(&self) -> String {
            fs::read_to_string(
                self.installed_app
                    .join("Contents")
                    .join("MacOS")
                    .join("Everr"),
            )
            .expect("read app marker binary")
        }
    }

    fn write_fake_app(dir: &Path, version: &str, marker: &str) -> PathBuf {
        let app = dir.join("Everr.app");
        let macos_dir = app.join("Contents").join("MacOS");
        fs::create_dir_all(&macos_dir).expect("create app bundle dirs");
        fs::write(
            app.join("Contents").join("Info.plist"),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>CFBundleShortVersionString</key>
	<string>{version}</string>
</dict>
</plist>
"#
            ),
        )
        .expect("write Info.plist");
        fs::write(macos_dir.join("Everr"), marker).expect("write app marker binary");
        app
    }

    fn app_archive(version: &str, marker: &str) -> Vec<u8> {
        let dir = tempfile::tempdir().expect("archive source dir");
        let app = write_fake_app(dir.path(), version, marker);
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        builder
            .append_dir_all("Everr.app", &app)
            .expect("append app bundle");
        builder
            .into_inner()
            .expect("finish tar")
            .finish()
            .expect("finish gzip")
    }

    #[test]
    fn upgrade_replaces_an_outdated_app_bundle() {
        let archive = app_archive("2099.1.0", "new-app-binary");
        let mut harness = AppUpgradeHarness::new("1.0.0", "2099.1.0", &sha256_hex(&archive));
        harness.mock_archive(&archive);

        harness
            .upgrade_command()
            .assert()
            .success()
            .stdout(contains("Upgraded Everr app v1.0.0 → v2099.1.0"));

        assert_eq!(
            harness.installed_marker(),
            "new-app-binary",
            "app bundle should be replaced with the downloaded one"
        );
        let plist = fs::read_to_string(harness.installed_app.join("Contents").join("Info.plist"))
            .expect("read replaced Info.plist");
        assert!(plist.contains("2099.1.0"));
    }

    #[test]
    fn upgrade_skips_the_app_when_it_is_up_to_date() {
        let harness = AppUpgradeHarness::new("3.0.0", "3.0.0", "unused");

        harness
            .upgrade_command()
            .assert()
            .success()
            .stdout(contains("Everr app already up to date (v3.0.0)"));

        assert_eq!(
            harness.installed_marker(),
            "old-app-binary",
            "an up-to-date app must not be touched"
        );
    }

    #[test]
    fn upgrade_aborts_on_app_checksum_mismatch_and_leaves_the_app_untouched() {
        let archive = app_archive("2099.1.0", "new-app-binary");
        let mut harness =
            AppUpgradeHarness::new("1.0.0", "2099.1.0", &sha256_hex(b"different bytes"));
        harness.mock_archive(&archive);

        harness
            .upgrade_command()
            .assert()
            .failure()
            .stderr(contains("checksum mismatch"));

        assert_eq!(
            harness.installed_marker(),
            "old-app-binary",
            "app must be untouched after a checksum mismatch"
        );
    }

    #[test]
    fn upgrade_aborts_on_bad_app_signature_and_leaves_the_app_untouched() {
        let archive = app_archive("2099.1.0", "new-app-binary");
        let mut harness = AppUpgradeHarness::new("1.0.0", "2099.1.0", &sha256_hex(&archive));
        harness.mock_archive_with_signature(&archive, b"not the archive bytes");

        harness
            .upgrade_command()
            .assert()
            .failure()
            .stderr(contains("signature"));

        assert_eq!(
            harness.installed_marker(),
            "old-app-binary",
            "app must be untouched after a signature mismatch"
        );
    }

    /// The metadata is unsigned, so a validly signed but older archive must
    /// not be installable under an inflated claimed version.
    #[test]
    fn upgrade_aborts_when_archive_version_does_not_match_metadata() {
        let archive = app_archive("1.5.0", "new-app-binary");
        let mut harness = AppUpgradeHarness::new("1.0.0", "2099.1.0", &sha256_hex(&archive));
        harness.mock_archive(&archive);

        harness
            .upgrade_command()
            .assert()
            .failure()
            .stderr(contains("refusing to swap"));

        assert_eq!(
            harness.installed_marker(),
            "old-app-binary",
            "app must be untouched after a version mismatch"
        );
    }

    /// Metadata published before the app fields existed must not fail the
    /// upgrade command for users who have the app installed.
    #[test]
    fn upgrade_skips_the_app_when_metadata_has_no_app_info() {
        let env = CliTestEnv::new();
        let mut server = mock_api_server();
        server
            .mock("GET", "/everr-app/release-metadata.json")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(format!(r#"{{"version":"{}"}}"#, env!("EVERR_VERSION")))
            .create();
        let install_dir = tempfile::tempdir().expect("install dir");
        let installed_app = write_fake_app(install_dir.path(), "1.0.0", "old-app-binary");

        let mut cmd = env.command_with_release_metadata_url(&format!(
            "{}/everr-app/release-metadata.json",
            server.url()
        ));
        cmd.env(APP_INSTALL_PATH_ENV, &installed_app);
        cmd.arg("upgrade")
            .assert()
            .success()
            .stdout(contains("Skipping the Everr app update"));

        let marker = fs::read_to_string(installed_app.join("Contents").join("MacOS").join("Everr"))
            .expect("read app marker binary");
        assert_eq!(marker, "old-app-binary", "app must be untouched");
    }
}

#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "x86_64"),
))]
mod supported_platform {
    use std::fs;
    use std::path::PathBuf;

    use assert_cmd::Command;
    use everr_cli::upgrade::release_binary_name;
    use predicates::str::contains;

    use crate::support::{CliTestEnv, mock_api_server};
    use crate::{DOWNLOAD_BASE_URL_ENV, sha256_hex};

    const RELEASE_METADATA_URL_ENV: &str = "EVERR_RELEASE_METADATA_URL_FOR_TESTS";
    const FAKE_BINARY: &[u8] = b"#!/bin/sh\necho fake-new-everr\n";

    /// A mock release server plus a copy of the built test binary in its own
    /// temp dir, so the upgrade can replace it without touching the real
    /// target/debug binary.
    struct UpgradeHarness {
        env: CliTestEnv,
        server: mockito::ServerGuard,
        _bin_dir: tempfile::TempDir,
        installed: PathBuf,
    }

    impl UpgradeHarness {
        fn new() -> Self {
            let env = CliTestEnv::new();
            let mut server = mock_api_server();
            server
                .mock("GET", "/everr-app/release-metadata.json")
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(r#"{"version":"2099.1.0"}"#)
                .create();

            let bin_dir = tempfile::tempdir().expect("bin dir");
            let installed = bin_dir.path().join("everr");
            fs::copy(assert_cmd::cargo::cargo_bin!("everr"), &installed).expect("copy test binary");

            Self {
                env,
                server,
                _bin_dir: bin_dir,
                installed,
            }
        }

        /// Serves FAKE_BINARY as the release artifact, published with the
        /// checksum of `checksum_of`.
        fn mock_artifacts(&mut self, checksum_of: &[u8]) {
            let name = release_binary_name().expect("supported platform");
            self.server
                .mock("GET", format!("/everr-app/{name}").as_str())
                .with_status(200)
                .with_body(FAKE_BINARY)
                .create();
            self.server
                .mock("GET", format!("/everr-app/{name}.sha256").as_str())
                .with_status(200)
                .with_body(format!("{}  {name}\n", sha256_hex(checksum_of)))
                .create();
        }

        fn upgrade_command(&self) -> Command {
            let mut cmd = self.upgrade_command_without_download_override();
            cmd.env(
                DOWNLOAD_BASE_URL_ENV,
                format!("{}/everr-app", self.server.url()),
            );
            cmd
        }

        fn upgrade_command_without_download_override(&self) -> Command {
            let mut cmd = self.env.command_for_binary(&self.installed);
            cmd.env(
                RELEASE_METADATA_URL_ENV,
                format!("{}/everr-app/release-metadata.json", self.server.url()),
            );
            cmd.arg("upgrade");
            cmd
        }

        fn installed_bytes(&self) -> Vec<u8> {
            fs::read(&self.installed).expect("read installed binary")
        }
    }

    #[test]
    fn upgrade_replaces_the_running_binary() {
        let mut harness = UpgradeHarness::new();
        harness.mock_artifacts(FAKE_BINARY);

        harness
            .upgrade_command()
            .assert()
            .success()
            .stdout(contains("Upgraded everr"));

        assert_eq!(
            harness.installed_bytes(),
            FAKE_BINARY,
            "installed binary should be replaced with the downloaded bytes"
        );
    }

    #[test]
    fn upgrade_aborts_on_checksum_mismatch_and_leaves_binary_untouched() {
        let mut harness = UpgradeHarness::new();
        harness.mock_artifacts(b"different bytes");
        let original = harness.installed_bytes();

        harness
            .upgrade_command()
            .assert()
            .failure()
            .stderr(contains("checksum mismatch"));

        assert_eq!(
            harness.installed_bytes(),
            original,
            "binary must be untouched after a checksum mismatch"
        );
    }

    #[test]
    fn debug_build_refuses_upgrade_without_download_override() {
        let harness = UpgradeHarness::new();
        let original = harness.installed_bytes();

        harness
            .upgrade_command_without_download_override()
            .assert()
            .failure()
            .stderr(contains("refusing to self-update a debug build"));

        assert_eq!(
            harness.installed_bytes(),
            original,
            "debug guard must leave the binary untouched"
        );
    }
}
