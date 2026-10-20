# Bundled skills

`everr skills` lists, installs, updates and uninstalls the agent skills embedded in the CLI (`everr-setup-resources`, `everr-setup-telemetry`, `everr-use-telemetry`, `everr-working-with-ci`), globally (`~/.agents/skills`) or per project (`./.agents/skills`), for Cursor, Codex, Claude Code, or all.

## Sub-features

- `skills-list` lists the 4 bundled skills with descriptions for a scope.
- `skills-dry-run` `install --dry-run` prints what it would write and writes nothing.
- `skills-install` writes each skill directory into `.agents/skills/` of the project.
- `skills-uninstall` removes them again (`--all --yes`).

## How to get to it (user POV)

- `everr skills list [--project|--global] [--agent cursor|codex|claude-code|all]`.
- `everr skills install [--all] [--project|--global] [--agent ...] [--dry-run]`.
- `everr skills update [names...]`, `everr skills uninstall [names...|--all --yes] [--dry-run]`.

## Driving it with verify-everr

Preconditions:

- A run exists (`$V launch`); no collector is needed, but the helper needs the run's throwaway `HOME` so `--global` can never touch the real one.
- A scratch git project: `P=$(mktemp -d) && git -C "$P" init -q`. Pass it with `VERIFY_CWD="$P"`.

- **List.** Run `VERIFY_CWD="$P" $V cli skills-list -- skills list --project`. Exit `0`, first line `4 bundled Everr skill(s) for project scope (all providers):`, then the 4 names.
- **Dry run.** Run `VERIFY_CWD="$P" $V cli skills-dry -- skills install --all --project --agent cursor --dry-run`. Stdout `Would install 4 skills: ...` with `would write: $P/.agents/skills/<name>` lines. Then `find "$P" -path "$P/.git" -prune -o -print` prints only `$P`: nothing written.
- **Install.** Run `VERIFY_CWD="$P" $V cli skills-install -- skills install --all --project --agent cursor`. Stdout `Installed 4 skills: ...`; `ls "$P/.agents/skills"` shows the 4 directories, each with a `SKILL.md`.
- **Uninstall.** Run `VERIFY_CWD="$P" $V cli skills-uninstall -- skills uninstall --all --yes --project --agent cursor`. Exit `0`; `$P/.agents/skills` no longer contains the 4 skills.
- **Proof.** The `cli/skills-*` folders plus the `find`/`ls` output saved next to them (`> .verify-everr/artifacts/$RUN_ID/cli/skills-install/fs.txt`). Then `rm -rf "$P"`.

## Gotchas

- The CLI embeds `skills/` at build time (`build.rs` reruns on `../../skills`). After editing a skill, rebuild before verifying, or you test the old copy.
- Without `--project` or `--global` the CLI may prompt; always pass a scope in non-interactive runs.
- `uninstall` prints `Uninstalled 4 skills: ...` with one `removed: <path>` line per skill; it leaves an empty `.agents/skills/` behind.
