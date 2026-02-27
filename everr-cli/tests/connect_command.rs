mod support;

use std::fs;

use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn connect_infers_repo_from_git_remote() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/tests",
        "git@github.com:citric-app/citric.git",
    );

    env.command()
        .current_dir(&repo_dir)
        .arg("connect")
        .assert()
        .success()
        .stdout(contains(
            "Open: https://app.everr.dev/api/github/install/start",
        ))
        .stdout(contains("select: citric-app/citric"));
}

#[test]
fn connect_accepts_repo_and_api_url_overrides() {
    let env = CliTestEnv::new();
    let non_git = env.home_dir.join("scratch");
    fs::create_dir_all(&non_git).expect("create non-git dir");

    env.command()
        .current_dir(&non_git)
        .args([
            "connect",
            "--repo",
            "acme/backend",
            "--api-base-url",
            "https://dev.everr.test/",
        ])
        .assert()
        .success()
        .stdout(contains(
            "Open: https://dev.everr.test/api/github/install/start",
        ))
        .stdout(contains("select: acme/backend"));
}

#[test]
fn connect_shows_generic_guidance_when_repo_cannot_be_resolved() {
    let env = CliTestEnv::new();
    let non_git = env.home_dir.join("scratch");
    fs::create_dir_all(&non_git).expect("create non-git dir");

    env.command()
        .current_dir(&non_git)
        .arg("connect")
        .assert()
        .success()
        .stdout(contains("choose the repository you want to observe"))
        .stdout(contains("pass --repo owner/name"));
}

#[test]
fn connect_uses_session_api_base_url_when_present() {
    let env = CliTestEnv::new();
    env.write_session("https://self-hosted.everr.test/", "token-123");

    env.command()
        .arg("connect")
        .assert()
        .success()
        .stdout(contains(
            "Open: https://self-hosted.everr.test/api/github/install/start",
        ));
}
