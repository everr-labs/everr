# CLI Guidelines

Rules for contributors adding or modifying everr CLI commands. Applies equally to human contributors and AI assistants working on this codebase.

---

## Rule 1: Always echo applied filters in JSON output

Every data-returning command must include a top-level field (e.g. `filters`) in its JSON response reflecting what was actually used — including defaults, values resolved from git context, and pagination.

**Why:** Output must be self-describing. AIs and scripts cannot reliably infer applied filters from context. Echoing them makes responses pipeable and auditable without re-running the command.

**Example:** `everr runs` already does this correctly:
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

`everr status` does not yet — it returns data without any filter envelope.

**Checklist:** When adding or modifying a data command, verify the JSON response includes all applied filter values.

---

## Rule 2: AI-useful commands belong in `ai-instructions`

Commands that help an AI understand or investigate CI must be documented in `ai-instructions`. Human-only commands must not appear there.

| Category | Commands |
|---|---|
| AI-useful (document in `ai-instructions`) | `status`, `watch`, `grep`, `runs`, `show`, `logs`, `workflows`, `test-history`, `slowest-tests`, `slowest-jobs` |
| Human-only (exclude from `ai-instructions`) | `setup`, `init`, `login`, `logout`, `uninstall`, `setup-assistant` |

**Why:** `ai-instructions` is the single source of truth for what an AI can use. Including setup/auth commands adds noise and risks an AI attempting to run interactive flows.

**Checklist:** When adding a command, decide: AI-useful or human-only? Add to `ai-instructions` accordingly.

---

## Rule 3: Keep `ai-instructions` concise — if you can't, refactor the command

Each command entry in `ai-instructions` should fit in one to two lines. If more is needed, treat it as a signal that the interface is too complex — refactor the command first, then document it.

**Why:** A command that is hard to explain in one line is usually hard for an AI to use correctly. Complexity in docs reflects complexity in the interface.

**Checklist:** If your `ai-instructions` entry grows beyond two lines, stop and reconsider the command's design.

---

## Rule 4: Commands must have a single, focused goal — output must reflect that

Each command solves one well-defined problem. Its output must be bounded to that goal: no mixing in sub-entity details that belong to a different command, and no response larger than ~30KB.

**Why:** When a command returns more than its stated goal requires, the useful signal gets buried. An AI or person looking for high-level run status shouldn't have to parse job/step details — that's what `show` is for. Focused output means faster decisions and cleaner drill-down paths.

**Example:** `everr runs` returns high-level metadata for recent runs. It must not include job or step details — use `everr show --trace-id <id>` to go deeper. The CLI has a natural drill-down path: `runs` → `show` → `logs`.

**Checklist:** When designing a command, write its one-sentence goal. If the output contains fields that belong to a different command's stated goal, move them there. If the response can exceed 30KB under normal usage, the command is doing too much.
