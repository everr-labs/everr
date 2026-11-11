// Each tests/*.rs file is its own binary that links the whole CLI, so the fast tests share one.
// local_lifecycle_commands stays separate so its real collectors do not starve these tests' short timeouts.
mod support;
mod api_commands;
mod auth_commands;
mod bundled_skills;
mod help_output;
mod internal_telemetry;
mod skills_commands;
mod telemetry_commands;
mod update_notice;
mod upgrade;
mod wrap_command;
