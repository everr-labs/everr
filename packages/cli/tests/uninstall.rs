mod support;

use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn npm_uninstall_removes_state_and_prints_package_removal_instructions() {
    let env = CliTestEnv::new();
    env.write_session("https://app.everr.dev", "test-token");
    env.command()
        .env("EVERR_INSTALL_SOURCE", "npm")
        .env("EVERR_NPM_INSTALL_SCOPE", "global")
        .arg("uninstall")
        .write_stdin("\n")
        .assert()
        .success()
        .stdout(contains("npm uninstall --global @everr/cli"))
        .stdout(contains("  rm ").not());
    assert!(!env.session_path().exists());
}
