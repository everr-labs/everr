# CLI Guidelines

Rules for contributors adding or modifying everr CLI commands. Applies equally to human contributors and AI assistants working on this codebase.

---

## Rule 1: Always echo applied filters in JSON output

Every data-returning command must include a top-level field (e.g. `filters`) in its JSON response reflecting what was actually used — including defaults, values resolved from git context, and pagination.

**Why:** Output must be self-describing. AIs and scripts cannot reliably infer applied filters from context. Echoing them makes responses pipeable and auditable without re-running the command.

**Example:** `everr ci runs` already does this correctly:
```json
{
  "filters": {
    "from": "now-7d",
    "limit": 20,
    "offset": 0,
    "repo": "everr-labs/everr",
    "to": "now"
  },
  "runs": [...]
}
```

`everr ci status` does not yet — it returns data without any filter envelope.

**Checklist:** When adding or modifying a data command, verify the JSON response includes all applied filter values.

---

## Rule 2: AI-useful guidance belongs in bundled skills

Commands that help an agent understand or investigate CI/local telemetry must be documented in the relevant bundled skill. Human-only commands must not be promoted as agent workflows.

| Category | Commands |
|---|---|
| Agent-useful (document in a skill) | `ci status`, `ci watch`, `cloud grep`, `ci runs`, `ci show`, `ci logs`, `local query`, `local endpoint`, `wrap` |
| Human-only (exclude from skills) | `setup`, `init`, `cloud login`, `cloud logout`, `uninstall` |

**Why:** Skills are the source of truth for what an agent can use. Including setup/auth commands adds noise and risks an agent attempting to run interactive flows.

**Checklist:** When adding a command, decide: agent-useful or human-only? Add the guidance to the right bundled skill when it is agent-useful.

---

## Rule 3: Keep skill command guidance concise — if you can't, refactor the command

The command itself should fit on one line. Flags may use sub-bullets, but only when they meaningfully extend the command (e.g. `--egrep`, `--log-failed`). If the command line itself needs more than one line to describe, treat it as a signal that the interface is too complex — refactor the command first, then document it.

**Why:** A command that is hard to explain in one line is usually hard for an AI to use correctly. Complexity in docs reflects complexity in the interface.

**Checklist:** If the command line itself (not its flags) needs more than one line to describe, stop and reconsider the command's design.

---

## Rule 4: Commands must have a single, focused goal — output must reflect that

Each command solves one well-defined problem. Its output must be bounded to that goal: no mixing in sub-entity details that belong to a different command, and no response larger than ~30KB.

**Why:** When a command returns more than its stated goal requires, the useful signal gets buried. An AI or person looking for high-level run status shouldn't have to parse job/step details — that's what `show` is for. Focused output means faster decisions and cleaner drill-down paths.

**Example:** `everr ci runs` returns high-level metadata for recent runs. It must not include job or step details — use `everr ci show <trace_id>` to go deeper. The CLI has a natural drill-down path: `ci runs` → `ci show` → `ci logs`.

**Checklist:** When designing a command, write its one-sentence goal. If the output contains fields that belong to a different command's stated goal, move them there. If the response can exceed 30KB under normal usage, the command is doing too much.
