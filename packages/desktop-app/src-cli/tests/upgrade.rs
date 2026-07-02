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

    use predicates::str::contains;
    use sha2::{Digest, Sha256};

    use crate::support::{CliTestEnv, mock_api_server};

    const DOWNLOAD_BASE_URL_ENV: &str = "EVERR_DOWNLOAD_BASE_URL_FOR_TESTS";
    const RELEASE_METADATA_URL_ENV: &str = "EVERR_RELEASE_METADATA_URL_FOR_TESTS";

    fn release_binary_name() -> &'static str {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => "everr",
            ("linux", "aarch64") => "everr-linux-arm64",
            ("linux", "x86_64") => "everr-linux-x86_64",
            (os, arch) => unreachable!("module is cfg-gated, got {os} {arch}"),
        }
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let digest = Sha256::digest(bytes);
        let mut out = String::with_capacity(digest.len() * 2);
        for byte in digest {
            out.push_str(&format!("{byte:02x}"));
        }
        out
    }

    /// Copies the built test binary into its own temp dir so the upgrade can
    /// replace it without touching the real target/debug binary.
    fn install_binary_copy(dir: &tempfile::TempDir) -> PathBuf {
        let installed = dir.path().join("everr");
        fs::copy(assert_cmd::cargo::cargo_bin!("everr"), &installed).expect("copy test binary");
        installed
    }

    #[test]
    fn upgrade_replaces_the_running_binary() {
        let env = CliTestEnv::new();
        let mut server = mock_api_server();
        let binary_name = release_binary_name();
        let fake_binary = b"#!/bin/sh\necho fake-new-everr\n".to_vec();

        server
            .mock("GET", "/everr-app/release-metadata.json")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"version":"2099.1.0"}"#)
            .create();
        server
            .mock("GET", format!("/everr-app/{binary_name}").as_str())
            .with_status(200)
            .with_body(fake_binary.clone())
            .create();
        server
            .mock("GET", format!("/everr-app/{binary_name}.sha256").as_str())
            .with_status(200)
            .with_body(format!("{}  {binary_name}\n", sha256_hex(&fake_binary)))
            .create();

        let bin_dir = tempfile::tempdir().expect("bin dir");
        let installed = install_binary_copy(&bin_dir);

        env.command_for_binary(&installed)
            .env(
                RELEASE_METADATA_URL_ENV,
                format!("{}/everr-app/release-metadata.json", server.url()),
            )
            .env(DOWNLOAD_BASE_URL_ENV, format!("{}/everr-app", server.url()))
            .arg("upgrade")
            .assert()
            .success()
            .stdout(contains("Upgraded everr"));

        assert_eq!(
            fs::read(&installed).expect("read installed binary"),
            fake_binary,
            "installed binary should be replaced with the downloaded bytes"
        );
    }

    #[test]
    fn upgrade_aborts_on_checksum_mismatch_and_leaves_binary_untouched() {
        let env = CliTestEnv::new();
        let mut server = mock_api_server();
        let binary_name = release_binary_name();
        let fake_binary = b"#!/bin/sh\necho fake-new-everr\n".to_vec();

        server
            .mock("GET", "/everr-app/release-metadata.json")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"version":"2099.1.0"}"#)
            .create();
        server
            .mock("GET", format!("/everr-app/{binary_name}").as_str())
            .with_status(200)
            .with_body(fake_binary.clone())
            .create();
        server
            .mock("GET", format!("/everr-app/{binary_name}.sha256").as_str())
            .with_status(200)
            .with_body(format!("{}  {binary_name}\n", sha256_hex(b"different bytes")))
            .create();

        let bin_dir = tempfile::tempdir().expect("bin dir");
        let installed = install_binary_copy(&bin_dir);
        let original = fs::read(&installed).expect("read original binary");

        env.command_for_binary(&installed)
            .env(
                RELEASE_METADATA_URL_ENV,
                format!("{}/everr-app/release-metadata.json", server.url()),
            )
            .env(DOWNLOAD_BASE_URL_ENV, format!("{}/everr-app", server.url()))
            .arg("upgrade")
            .assert()
            .failure()
            .stderr(contains("checksum mismatch"));

        assert_eq!(
            fs::read(&installed).expect("read installed binary"),
            original,
            "binary must be untouched after a checksum mismatch"
        );
    }

    #[test]
    fn debug_build_refuses_upgrade_without_download_override() {
        let env = CliTestEnv::new();
        let mut server = mock_api_server();
        server
            .mock("GET", "/everr-app/release-metadata.json")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"version":"2099.1.0"}"#)
            .create();

        let bin_dir = tempfile::tempdir().expect("bin dir");
        let installed = install_binary_copy(&bin_dir);
        let original = fs::read(&installed).expect("read original binary");

        env.command_for_binary(&installed)
            .env(
                RELEASE_METADATA_URL_ENV,
                format!("{}/everr-app/release-metadata.json", server.url()),
            )
            .arg("upgrade")
            .assert()
            .failure()
            .stderr(contains("refusing to self-update a debug build"));

        assert_eq!(
            fs::read(&installed).expect("read installed binary"),
            original,
            "debug guard must leave the binary untouched"
        );
    }
}
