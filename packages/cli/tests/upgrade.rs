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

#[test]
fn npm_upgrade_does_not_fetch_release_metadata() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();
    let metadata = server
        .mock("GET", "/everr-app/release-metadata.json")
        .expect(0)
        .create();

    env.command_with_release_metadata_url(&format!(
        "{}/everr-app/release-metadata.json",
        server.url()
    ))
    .env("EVERR_INSTALL_SOURCE", "npm")
    .arg("upgrade")
    .assert()
    .success();
    metadata.assert();
}
