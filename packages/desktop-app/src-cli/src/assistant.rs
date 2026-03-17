use anyhow::Result;
use everr_core::assistant as core_assistant;
use everr_core::build;

pub fn init_repo_instructions() -> Result<()> {
    let cwd = std::env::current_dir()?;
    let path = core_assistant::init_repo_instructions(&cwd, build::command_name())?;
    println!("Configured Everr instructions at {}", path.display());
    Ok(())
}

pub fn print_ai_instructions() {
    print!(
        "{}",
        include_str!("../../../../crates/everr-core/assets/assistant-instructions.md")
            .replace("`everr ", &format!("`{} ", build::command_name()))
    );
}

pub fn remove_managed_prompts() -> Result<()> {
    core_assistant::remove_managed_prompts()
}

#[cfg(test)]
mod tests {
    use everr_core::build;

    #[test]
    fn command_name_is_fixed() {
        assert_eq!(build::command_name(), "everr");
    }
}
