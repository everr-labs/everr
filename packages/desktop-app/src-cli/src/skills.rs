use std::collections::BTreeSet;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use everr_core::skills::{
    self as core_skills, InstallMode, SkillOperationOptions, SkillOperationSummary,
    SkillPathAction, SkillProvider, SkillScope, bundled_skills, install_bundled_skills,
    uninstall_bundled_skills, update_bundled_skills,
};
use std::io::IsTerminal;

use crate::cli::{
    SkillAgentArg, SkillScopeArgs, SkillsArgs, SkillsInstallArgs, SkillsListArgs, SkillsSubcommand,
    SkillsUninstallArgs, SkillsUpdateArgs,
};

pub fn run(args: SkillsArgs) -> Result<()> {
    match args.command {
        SkillsSubcommand::List(args) => run_list(args),
        SkillsSubcommand::Install(args) => run_install(args),
        SkillsSubcommand::Update(args) => run_update(args),
        SkillsSubcommand::Uninstall(args) => run_uninstall(args),
    }
}

fn run_list(args: SkillsListArgs) -> Result<()> {
    let scope = resolve_scope(&args.scope);
    let providers = resolve_providers(&args.agents);
    let skills = bundled_skills()?;
    let scope_label = match scope {
        SkillScope::Project => "project",
        SkillScope::Global => "global",
    };
    let provider_label = if providers.is_empty() {
        "all providers".to_string()
    } else {
        providers
            .iter()
            .map(|provider| provider.display_name())
            .collect::<Vec<_>>()
            .join(", ")
    };

    println!(
        "{} bundled Everr skill(s) for {scope_label} scope ({provider_label}):",
        skills.len()
    );
    for skill in skills {
        println!("- {} - {}", skill.name, skill.description);
    }
    Ok(())
}

fn run_install(args: SkillsInstallArgs) -> Result<()> {
    if args.all && !args.skills.is_empty() {
        bail!("skill names cannot be provided when --all is set");
    }

    let interactive = is_interactive_terminal();
    if !args.all && args.skills.is_empty() && !interactive {
        bail!("provide at least one skill name or use --all");
    }

    let full_interactive_install = interactive && !args.all && args.skills.is_empty();
    let home_dir = resolve_home_dir()?;
    let skill_names = if !args.all && args.skills.is_empty() {
        prompt_skills_to_install()?
    } else {
        args.skills
    };
    let scope = if args.scope.project || args.scope.global {
        resolve_scope(&args.scope)
    } else if interactive {
        prompt_scope()?
    } else {
        SkillScope::Project
    };
    let providers = if args.agents.is_empty() {
        if interactive {
            prompt_providers(&home_dir)?
        } else {
            Vec::new()
        }
    } else {
        resolve_providers(&args.agents)
    };
    let mode = if args.copy {
        InstallMode::Copy
    } else if full_interactive_install {
        prompt_install_mode()?
    } else {
        InstallMode::Symlink
    };

    let options = operation_options(
        scope,
        home_dir,
        providers,
        skill_names,
        args.all,
        mode,
        args.force,
        args.dry_run,
    )?;
    let summary = install_bundled_skills(&options)?;
    print_summary("Installed", "Would install", &summary);
    Ok(())
}

fn run_update(args: SkillsUpdateArgs) -> Result<()> {
    let home_dir = resolve_home_dir()?;
    let providers = resolve_providers(&args.agents);
    if !args.scope.project && !args.scope.global {
        let summary = update_installed_scopes(home_dir, providers, args.skills, args.dry_run)?;
        print_summary("Updated", "Would update", &summary);
        return Ok(());
    }

    let options = operation_options(
        resolve_scope(&args.scope),
        home_dir,
        providers,
        args.skills,
        false,
        InstallMode::Symlink,
        true,
        args.dry_run,
    )?;
    let summary = update_bundled_skills(&options)?;
    print_summary("Updated", "Would update", &summary);
    Ok(())
}

fn update_installed_scopes(
    home_dir: PathBuf,
    providers: Vec<SkillProvider>,
    requested_skills: Vec<String>,
    dry_run: bool,
) -> Result<SkillOperationSummary> {
    let requested_skills = if requested_skills.is_empty() {
        None
    } else {
        Some(normalize_requested_skill_names(requested_skills)?)
    };
    let mut summaries = Vec::new();

    for scope in [SkillScope::Project, SkillScope::Global] {
        let probe_options = operation_options(
            scope,
            home_dir.clone(),
            providers.clone(),
            Vec::new(),
            false,
            InstallMode::Symlink,
            true,
            dry_run,
        )?;
        let installed: BTreeSet<String> =
            core_skills::installed_bundled_skill_names(&probe_options)?
                .into_iter()
                .collect();
        let skill_names = match &requested_skills {
            Some(requested) => requested
                .iter()
                .filter(|name| installed.contains(*name))
                .cloned()
                .collect::<Vec<_>>(),
            None => installed.into_iter().collect(),
        };
        if skill_names.is_empty() {
            continue;
        }

        let options = SkillOperationOptions {
            skill_names,
            ..probe_options
        };
        summaries.push(update_bundled_skills(&options)?);
    }

    if summaries.is_empty() {
        if let Some(requested) = requested_skills {
            bail!(
                "no installed bundled Everr skills found matching {}",
                requested.join(", ")
            );
        }
        bail!("no installed bundled Everr skills found in project or global scope");
    }

    Ok(merge_summaries(summaries, dry_run))
}

fn normalize_requested_skill_names(skills: Vec<String>) -> Result<Vec<String>> {
    let available: BTreeSet<String> = bundled_skills()?
        .into_iter()
        .map(|skill| skill.name)
        .collect();
    let mut names = BTreeSet::new();
    for skill in skills {
        let name = skill.trim().to_string();
        if name.is_empty() {
            continue;
        }
        if !available.contains(&name) {
            bail!("unknown skill {name:?}");
        }
        names.insert(name);
    }
    if names.is_empty() {
        bail!("provide at least one skill name");
    }
    Ok(names.into_iter().collect())
}

fn merge_summaries(summaries: Vec<SkillOperationSummary>, dry_run: bool) -> SkillOperationSummary {
    let mut skills = BTreeSet::new();
    let mut changes = Vec::new();
    for summary in summaries {
        skills.extend(summary.skills);
        changes.extend(summary.changes);
    }
    SkillOperationSummary {
        skills: skills.into_iter().collect(),
        changes,
        dry_run,
    }
}

fn run_uninstall(args: SkillsUninstallArgs) -> Result<()> {
    if args.all && !args.skills.is_empty() {
        bail!("skill names cannot be provided when --all is set");
    }
    if !args.all && args.skills.is_empty() {
        bail!("provide at least one skill name or use --all");
    }
    if args.all && !args.yes {
        bail!("refusing to uninstall all bundled Everr skills without --yes");
    }

    let options = operation_options(
        resolve_scope(&args.scope),
        resolve_home_dir()?,
        resolve_providers(&args.agents),
        args.skills,
        args.all,
        InstallMode::Symlink,
        false,
        args.dry_run,
    )?;
    let summary = uninstall_bundled_skills(&options)?;
    print_summary("Uninstalled", "Would uninstall", &summary);
    Ok(())
}

pub(crate) fn install_all_for_setup(
    scope: SkillScope,
    providers: Vec<SkillProvider>,
    mode: InstallMode,
    force: bool,
) -> Result<()> {
    let cwd = std::env::current_dir().context("could not determine current directory")?;
    let home_dir = resolve_home_dir()?;
    let options = SkillOperationOptions {
        scope,
        cwd,
        home_dir,
        providers,
        skill_names: Vec::new(),
        all: true,
        mode,
        force,
        dry_run: false,
    };
    let summary = install_bundled_skills(&options)?;
    print_summary("Installed", "Would install", &summary);
    Ok(())
}

fn operation_options(
    scope: SkillScope,
    home_dir: PathBuf,
    providers: Vec<SkillProvider>,
    skills: Vec<String>,
    all: bool,
    mode: InstallMode,
    force: bool,
    dry_run: bool,
) -> Result<SkillOperationOptions> {
    Ok(SkillOperationOptions {
        scope,
        cwd: std::env::current_dir().context("could not determine current directory")?,
        home_dir,
        providers,
        skill_names: skills,
        all,
        mode,
        force,
        dry_run,
    })
}

fn resolve_scope(args: &SkillScopeArgs) -> SkillScope {
    if args.global {
        SkillScope::Global
    } else {
        SkillScope::Project
    }
}

fn resolve_providers(args: &[SkillAgentArg]) -> Vec<SkillProvider> {
    if args.is_empty() || args.contains(&SkillAgentArg::All) {
        return Vec::new();
    }
    args.iter()
        .map(|agent| match agent {
            SkillAgentArg::All => unreachable!("handled above"),
            SkillAgentArg::Codex => SkillProvider::Codex,
            SkillAgentArg::ClaudeCode => SkillProvider::ClaudeCode,
            SkillAgentArg::Cursor => SkillProvider::Cursor,
        })
        .collect()
}

fn resolve_home_dir() -> Result<PathBuf> {
    dirs::home_dir().context("failed to resolve home directory")
}

fn is_interactive_terminal() -> bool {
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal()
}

fn prompt_skills_to_install() -> Result<Vec<String>> {
    let skills = bundled_skills()?;
    let mut prompt = cliclack::multiselect("Select skills to install").required(true);
    for skill in &skills {
        prompt = prompt.item(
            skill.name.clone(),
            skill.name.clone(),
            skill.description.clone(),
        );
    }
    let defaults: Vec<String> = skills.iter().map(|skill| skill.name.clone()).collect();
    let selected: Vec<String> = prompt.initial_values(defaults).interact()?;
    if selected.is_empty() {
        bail!("no skills selected");
    }
    Ok(selected)
}

fn prompt_scope() -> Result<SkillScope> {
    let global: bool = cliclack::confirm("Install skills globally instead of in this project?")
        .initial_value(false)
        .interact()?;
    if global {
        Ok(SkillScope::Global)
    } else {
        Ok(SkillScope::Project)
    }
}

fn prompt_providers(home_dir: &PathBuf) -> Result<Vec<SkillProvider>> {
    let provider_statuses = core_skills::provider_statuses(home_dir);
    let mut prompt = cliclack::multiselect("Select providers").required(true);
    for (i, status) in provider_statuses.iter().enumerate() {
        let hint = if status.detected {
            "detected"
        } else {
            "not detected"
        };
        prompt = prompt.item(i, status.provider.display_name(), hint);
    }
    let mut defaults: Vec<usize> = provider_statuses
        .iter()
        .enumerate()
        .filter(|(_, status)| status.detected)
        .map(|(i, _)| i)
        .collect();
    if defaults.is_empty() {
        defaults = (0..provider_statuses.len()).collect();
    }

    let selected_indices: Vec<usize> = prompt.initial_values(defaults).interact()?;
    let providers: Vec<SkillProvider> = selected_indices
        .iter()
        .map(|&i| provider_statuses[i].provider)
        .collect();
    if providers.is_empty() {
        bail!("no providers selected");
    }
    Ok(providers)
}

fn prompt_install_mode() -> Result<InstallMode> {
    let copy: bool = cliclack::confirm("Copy skills instead of symlinking provider folders?")
        .initial_value(false)
        .interact()?;
    if copy {
        Ok(InstallMode::Copy)
    } else {
        Ok(InstallMode::Symlink)
    }
}

fn print_summary(done: &str, dry_run: &str, summary: &everr_core::skills::SkillOperationSummary) {
    let verb = if summary.dry_run { dry_run } else { done };
    let suffix = if summary.skills.len() == 1 { "" } else { "s" };
    println!("{verb} {} skill{suffix}", summary.skills.len());
    for change in &summary.changes {
        if change.action == SkillPathAction::Unchanged {
            continue;
        }
        let action = match change.action {
            SkillPathAction::WouldWrite => "would write",
            SkillPathAction::Written => "wrote",
            SkillPathAction::WouldRemove => "would remove",
            SkillPathAction::Removed => "removed",
            SkillPathAction::Missing => "missing",
            SkillPathAction::WouldLink => "would link",
            SkillPathAction::Linked => "linked",
            SkillPathAction::WouldCopy => "would copy",
            SkillPathAction::Copied => "copied",
            SkillPathAction::Unchanged => "unchanged",
        };
        match change.provider {
            Some(provider) => println!(
                "- {} {} for {}: {}",
                change.skill,
                action,
                provider.display_name(),
                change.path
            ),
            None => println!("- {} {}: {}", change.skill, action, change.path),
        }
    }
}
