mod support;

use predicates::str::contains;
use support::{CliTestEnv, mock_api_server};

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
    use sha2::{Digest, Sha256};

    use crate::support::{CliTestEnv, mock_api_server};

    const DOWNLOAD_BASE_URL_ENV: &str = "EVERR_DOWNLOAD_BASE_URL_FOR_TESTS";
    const RELEASE_METADATA_URL_ENV: &str = "EVERR_RELEASE_METADATA_URL_FOR_TESTS";
    const FAKE_BINARY: &[u8] = b"#!/bin/sh\necho fake-new-everr\n";

    fn sha256_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

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
            fs::copy(assert_cmd::cargo::cargo_bin!("everr"), &installed)
                .expect("copy test binary");

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
