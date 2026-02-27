mod support;

use std::fs;

use support::{CliTestEnv, parse_stdout_json};

#[test]
fn context_returns_git_metadata_inside_repository() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/tests",
        "git@github.com:citric-app/citric.git",
    );

    let assert = env
        .command()
        .current_dir(&repo_dir)
        .arg("context")
        .assert()
        .success();

    let body = parse_stdout_json(assert.get_output().stdout.as_slice());
    let repo_dir_canonical = fs::canonicalize(&repo_dir)
        .expect("canonical repo dir")
        .display()
        .to_string();

    assert_eq!(body["repo"], "citric-app/citric");
    assert_eq!(body["branch"], "feature/tests");
    assert_eq!(body["origin"], "git@github.com:citric-app/citric.git");
    assert_eq!(body["gitRoot"], repo_dir_canonical);
    assert_eq!(body["cwd"], repo_dir_canonical);
}

#[test]
fn context_returns_null_fields_outside_git_repository() {
    let env = CliTestEnv::new();
    let non_git = env.home_dir.join("scratch");
    fs::create_dir_all(&non_git).expect("create non git dir");

    let assert = env
        .command()
        .current_dir(&non_git)
        .arg("context")
        .assert()
        .success();

    let body = parse_stdout_json(assert.get_output().stdout.as_slice());
    let non_git_canonical = fs::canonicalize(&non_git)
        .expect("canonical non-git dir")
        .display()
        .to_string();

    assert_eq!(body["cwd"], non_git_canonical);
    assert!(body["repo"].is_null());
    assert!(body["branch"].is_null());
    assert!(body["origin"].is_null());
    assert!(body["gitRoot"].is_null());
}
