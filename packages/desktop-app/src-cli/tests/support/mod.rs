#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;

use assert_cmd::Command;
use everr_core::build;
use mockito::{Server, ServerGuard};
use serde_json::Value;
use tempfile::TempDir;

const API_BASE_URL_OVERRIDE_ENV: &str = "EVERR_API_BASE_URL_FOR_TESTS";

pub struct CliTestEnv {
    _temp_dir: TempDir,
    pub home_dir: PathBuf,
    pub config_dir: PathBuf,
}

impl CliTestEnv {
    pub fn new() -> Self {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let home_dir = temp_dir.path().join("home");
        fs::create_dir_all(&home_dir).expect("create home dir");
        let config_dir = platform_config_dir(&home_dir);
        fs::create_dir_all(&config_dir).expect("create config dir");

        Self {
            _temp_dir: temp_dir,
            home_dir,
            config_dir,
        }
    }

    pub fn command(&self) -> Command {
        let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("everr"));
        cmd.env("HOME", &self.home_dir);
        cmd.env("XDG_CONFIG_HOME", &self.config_dir);
        cmd.env("XDG_DATA_HOME", self.home_dir.join(".local").join("share"));
        cmd
    }

    pub fn command_with_api_base_url(&self, api_base_url: &str) -> Command {
        let mut cmd = self.command();
        cmd.env(API_BASE_URL_OVERRIDE_ENV, api_base_url);
        cmd
    }

    pub fn session_path(&self) -> PathBuf {
        self.config_dir
            .join(build::session_namespace())
            .join(build::default_session_file_name())
    }

    pub fn telemetry_dir(&self) -> PathBuf {
        self.home_dir
            .join("Library")
            .join("Application Support")
            .join("everr")
            .join("telemetry-dev")
    }

    pub fn write_session(&self, api_base_url: &str, token: &str) {
        let session_path = self.session_path();
        if let Some(parent) = session_path.parent() {
            fs::create_dir_all(parent).expect("create session parent dir");
        }

        let body = serde_json::json!({
            "session": {
                "api_base_url": api_base_url,
                "token": token,
            },
            "settings": {
                "completed_base_url": null,
                "wizard_completed": false,
            },
        });
        fs::write(
            session_path,
            serde_json::to_string_pretty(&body).expect("serialize session"),
        )
        .expect("write session file");
    }

    pub fn init_git_repo(&self, relative_dir: &str, branch: &str, remote: &str) -> PathBuf {
        let repo_dir = self.home_dir.join(relative_dir);
        fs::create_dir_all(&repo_dir).expect("create repo dir");

        run_git(&repo_dir, ["init"]);
        run_git(&repo_dir, ["config", "user.email", "tests@example.com"]);
        run_git(&repo_dir, ["config", "user.name", "Test User"]);

        fs::write(repo_dir.join("README.md"), "# test repo\n").expect("write readme");
        run_git(&repo_dir, ["add", "README.md"]);
        run_git(&repo_dir, ["commit", "-m", "init"]);
        run_git(&repo_dir, ["checkout", "-b", branch]);
        run_git(&repo_dir, ["remote", "add", "origin", remote]);

        repo_dir
    }
}

pub fn mock_api_server() -> ServerGuard {
    Server::new()
}

fn platform_config_dir(home_dir: &Path) -> PathBuf {
    home_dir.join("Library").join("Application Support")
}

pub fn parse_stdout_json(output: &[u8]) -> Value {
    let body = std::str::from_utf8(output).expect("stdout should be utf8");
    serde_json::from_str(body).expect("stdout should contain valid JSON")
}

fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
    let status = ProcessCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .status()
        .expect("run git command");
    assert!(status.success(), "git command failed");
}
