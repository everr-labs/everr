---
name: review-current-branch
description: Review the current branch diff against its intended base branch (default branch if unspecified) for correctness, regressions, performance issues, risky coverage gaps, and unnecessary complexity. Use when the user asks for a code review, PR review, or branch review. Spawns 3 parallel reviewer agents, then validates and synthesizes only defensible findings.
---

# Review Current Branch

Use this skill when the user wants a review of the current branch or checked-out PR. The output must be a code review, not an implementation plan or patch.

## Review Standard

- Findings first, ordered by severity.
- Every finding needs a concrete `file:line` reference in changed code.
- `critical`: likely merge blocker, security issue, or high-confidence regression.
- `warning`: real issue worth fixing before merge.
- `nitpick`: lower-risk but still defensible issue. Do not use it for style-only commentary.
- Prefer merge blockers, behavioral regressions, security issues, real performance issues, and complexity that materially increases maintenance risk.
- Missing tests are findings only when the diff introduces a risky behavior change and the lack of coverage materially increases regression risk.
- If nothing survives validation, say `No findings.` and mention any residual risk or testing gaps.

## Step 0: Lock the Review Scope

- If the user specifies a base branch, PR target, file subset, or review focus, honor it and pass it through to reviewers.
- By default, review the committed branch diff `base...HEAD`. Do not include unstaged or staged working-tree changes unless the user explicitly asks for them.
- Ignore purely generated artifacts, lockfiles, snapshots, or vendored code unless they imply a real issue in handwritten code or release behavior.

## Step 1: Pick the Base Branch

Resolve the review base in this order:

1. The user-specified base, if any
2. The branch pointed to by `origin/HEAD`
3. `origin/main`
4. `origin/master`
5. `main`
6. `master`

Verify each candidate exists before selecting it. If none exist, ask the user which base to compare against.

Use triple-dot diffs against that base. Collect:

- `git diff --name-only <base>...HEAD`
- `git diff --stat <base>...HEAD`
- `git diff --shortstat <base>...HEAD`
- `git diff --unified=80 <base>...HEAD` only when the diff is small enough to pass around comfortably

If the changed file list is empty, report that there is nothing to review and stop.

## Step 2: Load Repo-Specific Review Context When Needed

Inspect the changed files before spawning reviewers.

- If the diff touches ClickHouse SQL, schemas, or configs, read `.agents/skills/clickhouse-best-practices/SKILL.md` and the relevant rule files before reviewing those findings.
- If you surface a ClickHouse finding in the final review, cite the relevant rule number or title when it materially supports the claim.
- If the diff touches `src-tauri`, `tauri.conf*`, capabilities, or Rust IPC code, read `.agents/skills/tauri-v2/SKILL.md`.
- Pull in other repo-local skills only when the changed files clearly match them.

Keep only the relevant constraints. Do not dump entire skill files into every reviewer prompt.

## Step 3: Spawn Reviewers in Parallel

Use `spawn_agent` with `agent_type: "explorer"` for 3 reviewers in parallel. Give each reviewer:

- The chosen base ref
- The changed file list
- The diff stat
- The user's explicit review scope or focus, if any
- Any relevant repo-specific constraints from Step 2
- Instructions to inspect files directly with git commands instead of relying only on pasted diff
- Instructions to verify line numbers with `nl -ba <path>` or equivalent before returning findings
- A limit of at most 5 high-confidence findings

Do not ask reviewers to edit files.

If the diff is small, you may include it directly. If it is large, tell reviewers to fetch targeted patches with `git diff <base>...HEAD -- <path>` and surrounding file context as needed. Prefer passing explicit task context over dumping the full conversation.

Each reviewer must return only concrete findings in this format:

```markdown
## {Reviewer Name}

1. [critical|warning|nitpick] `path/to/file:line` - explanation
2. ...
```

If there are no defensible findings, they must return `No findings.`

### Reviewer 1: Simplicity

Use this prompt:

```text
You are a simplicity reviewer. Review this branch diff for unnecessary complexity.

Focus on:
- Unnecessary abstractions or indirection
- Premature generalization for hypothetical future needs
- Code that could be expressed more simply without losing clarity
- New files or modules that are not justified by the change
- Patterns that materially diverge from the local codebase without a clear reason
- Dead code or unused exports introduced by the diff
- Refactors that increase moving parts without a matching payoff

Do not flag:
- Formatting or naming preferences
- Pure style disagreements
- Complexity that is clearly required by the problem
- Broad rewrites when a small local change would address the issue

Inspect the changed files directly and read surrounding context before making claims.
Return at most 5 findings, and only when they are high confidence.

Return only:
## Simplicity Review
1. [critical|warning|nitpick] `path:line` - explanation
...

If nothing is defensible, return `No findings.`
```

### Reviewer 2: Performance

Use this prompt:

```text
You are a performance reviewer for an application where the main bottlenecks are database queries, network calls, and request-time data processing.

Focus on:
- N+1 query patterns
- Repeated API or DB calls that could be consolidated
- Unbounded reads or missing filters on hot paths
- Fetching materially more data than needed
- Regressions in request-time serialization or aggregation work
- Missing indexes or obviously inefficient access patterns when the diff introduces them

Do not flag:
- Micro-optimizations
- Rarely used scripts, one-off migrations, or admin-only paths unless the impact is substantial
- ClickHouse `PREWHERE` suggestions unless the evidence is strong
- Missing tenant filters when repo policy already covers them
- Speculative index advice when the diff does not introduce a new hot query shape

Inspect the changed files directly and read surrounding query/schema context before making claims.
Return at most 5 findings, and only when they are high confidence.

Return only:
## Performance Review
1. [critical|warning|nitpick] `path:line` - explanation
...

If nothing is defensible, return `No findings.`
```

### Reviewer 3: Bug Hunter

Use this prompt:

```text
You are a bug hunter reviewing a code diff for correctness issues.

Focus on:
- Logic errors and incorrect branching
- Off-by-one mistakes
- Missing null/undefined/empty-state handling
- Broken error handling
- Type mismatches or incorrect assertions
- Missing validation at system boundaries
- Security issues such as injection, XSS, auth bypass, or unsafe command execution
- Concurrency, ordering, or race-condition regressions when the changed code is stateful or async
- Risky behavior changes that lack any meaningful test coverage near the modified path

Do not flag:
- Hypothetical issues that depend on unlikely conditions
- Style or readability comments
- Generic requests for more tests when the risk is low or already covered elsewhere

Inspect the changed files directly and read surrounding context before making claims.
Return at most 5 findings, and only when they are high confidence.

Return only:
## Bug Hunter Review
1. [critical|warning|nitpick] `path:line` - explanation
...

If nothing is defensible, return `No findings.`
```

## Step 4: Validate Every Candidate Finding Yourself

Do the validation in the main agent unless a separate verifier materially reduces risk without blocking progress.

For each candidate finding:

- Reopen the relevant diff hunk and surrounding file context
- Confirm the issue is caused by changed code or is a direct regression risk from it
- Verify the cited line number against the checked-out file with `nl -ba` or equivalent
- Discard duplicates, style notes, and speculative claims
- Discard findings in untouched files unless the diff clearly triggers the issue
- Discard noise from generated files unless it exposes a real handwritten-code problem
- Discard generic "needs more tests" comments unless they are tied to a concrete risky behavior change
- Downgrade severity when the impact is limited or the failure mode is narrow
- Run quick targeted commands or tests only when they materially confirm or refute the finding
- Merge overlapping findings into the single clearest statement

Do not blindly merge reviewer lists.

## Step 5: Write the Final Review

Final response shape:

1. Findings: numbered, ordered `critical` then `warning` then `nitpick`
2. Open questions or assumptions: only when needed
3. Summary: 1-3 sentences, only after the findings

Each finding should follow this form:

```markdown
1. [warning] `path/to/file:line` - concise explanation of the issue and why it matters.
```

If no findings survive validation, say `No findings.` and mention any residual risk or tests you did not run.

## Rules

1. Always run the 3 reviewers in parallel.
2. Review changed code first; only look outside the diff for necessary context.
3. Preserve the user's explicit scope and focus areas.
4. Prefer precise, defensible findings over exhaustive commentary.
5. Never report an unvalidated reviewer claim.
6. Do not turn style preferences, speculative index suggestions, or generic testing wishes into findings.
7. Keep prompts and outputs lean; large diffs should be inspected in the workspace, not pasted wholesale.
8. Default to the committed diff; include working-tree changes only on request.
9. Do not block on full test runs unless a finding genuinely depends on them.
