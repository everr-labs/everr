use anyhow::Result;
use everr_core::assistant as core_assistant;

pub fn print_repo_instructions() {
    print!("{}", core_assistant::render_discovery_instructions());
}

pub fn print_ai_instructions() {
    print!("{}", core_assistant::render_assistant_instructions());
}

pub fn remove_managed_prompts() -> Result<()> {
    core_assistant::remove_managed_prompts()
}
