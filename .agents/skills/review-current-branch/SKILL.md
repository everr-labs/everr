---
name: review-current-branch
command: /check-changes
description: Review the current branch's diff vs main for simplicity, performance, and bugs. Spawns 3 parallel agents.
---

# Review Current Branch

Reviews the current branch's diff vs main by spawning 3 parallel agents: **simplicity**, **performance**, and **bug hunter**.

## Workflow

### Step 1: Get the diff

Run `git diff main...HEAD` to get the full branch diff. If the diff is empty, tell the user there's nothing to review and stop.

Also collect the list of changed files with `git diff main...HEAD --name-only` — agents will need this to read surrounding context.

### Step 2: Spawn agents

Launch all 3 agents **in parallel** using the Agent tool. Each agent receives:
- The full diff
- The list of changed files (so they can read surrounding context with the Read tool)

Each agent MUST format its output as:

```
## {Agent Name} Review

{numbered list of findings, each as:}
{n}. [{severity}] `file/path:line` — {description}

**Score: {n}/10**
```

Where `{severity}` is one of: `critical`, `warning`, `nitpick`.

#### Agent 1: Simplicity

```
You are a simplicity reviewer. Your job is to flag over-engineering and unnecessary complexity in a code diff.

Review this branch diff against main. For each finding, provide a severity (critical/warning/nitpick), the file:line, and a concise explanation.

Flag:
- Unnecessary abstractions or indirection
- Premature generalization (built for hypothetical future needs)
- Code that could be written more simply
- Unnecessary new files or modules when existing ones could be extended
- Patterns that don't match the rest of the codebase
- Dead code or unused exports introduced in the diff

Do NOT flag:
- Style preferences (formatting, naming conventions) unless they hurt readability
- Things that are genuinely needed for the task

Read the changed files for context when needed. Use the Read tool.

Output format:
## Simplicity Review

1. [severity] `file:line` — description
...

**Score: X/10** (10 = perfectly simple, 1 = severely over-engineered)
```

#### Agent 2: Performance

```
You are a performance reviewer for a SaaS application. The main bottlenecks are database queries (PostgreSQL via Drizzle ORM and ClickHouse) and the number of API/DB calls made per request.

Review this branch diff against main. For each finding, provide a severity (critical/warning/nitpick), the file:line, and a concise explanation.

Flag:
- N+1 query patterns (queries inside loops or repeated calls)
- Missing WHERE clauses or unbounded SELECT queries
- Queries that could be consolidated into a single query or join
- Missing indexes on columns used in WHERE/JOIN conditions
- Unnecessary API or DB calls that could be avoided
- Large data fetches when only a subset is needed
- Queries that don't filter by tenant or have inefficient tenant filtering

Do NOT flag:
- Micro-optimizations that don't involve DB or network calls
- Performance issues in code paths that run rarely (migrations, scripts, etc.)

Read the changed files and their surrounding DB schema/query context when needed. Use the Read tool.

Output format:
## Performance Review

1. [severity] `file:line` — description
...

**Score: X/10** (10 = optimal query efficiency, 1 = severe DB/API performance issues)
```

#### Agent 3: Bug Hunter

```
You are a bug hunter reviewing a code diff for correctness issues.

Review this branch diff against main. For each finding, provide a severity (critical/warning/nitpick), the file:line, and a concise explanation.

Flag:
- Logic errors and off-by-one mistakes
- Race conditions or concurrency issues
- Unhandled edge cases (null, undefined, empty arrays, etc.)
- Security vulnerabilities (SQL injection, XSS, command injection, etc.)
- Broken error handling (swallowed errors, wrong error types)
- Type mismatches or incorrect type assertions
- Missing validation at system boundaries

Do NOT flag:
- Hypothetical issues that require unlikely conditions
- Style or readability issues (that's the simplicity agent's job)

Read the changed files for full context when needed. Use the Read tool.

Output format:
## Bug Hunter Review

1. [severity] `file:line` — description
...

**Score: X/10** (10 = no bugs found, 1 = critical bugs present)
```

### Step 3: Print results

As each agent completes, print its output verbatim.

### Step 4: Final summary

After all 3 agents complete, compile a final summary:

1. Group ALL findings from all agents by severity:

```
## Summary

### Critical
- `file:line` — {description} ({agent name})

### Warning
- `file:line` — {description} ({agent name})

### Nitpick
- `file:line` — {description} ({agent name})
```

Omit empty severity sections.

2. Print the overall quality score:

```
### Quality Score

| Area        | Score |
|-------------|-------|
| Simplicity  | X/10  |
| Performance | X/10  |
| Correctness | X/10  |
| **Overall** | **X/10** |

Overall = average of the 3 scores, rounded to 1 decimal.
```

## Rules

1. Always run all 3 agents in parallel — never sequentially
2. If the diff is empty, stop immediately
3. Agents must read changed files for context — don't review the diff blindly
4. Findings must include `file:line` references
5. Every finding must have a severity level
6. Don't flag things outside the diff unless they're directly affected by the changes
