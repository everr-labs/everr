# Getting Started Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the long getting started guide into a multi-page docs section.

**Architecture:** Replace the single `packages/docs/content/docs/getting-started.mdx` file with a `packages/docs/content/docs/getting-started/` folder. The folder gets an `index.mdx` overview page, three focused child pages, and a `meta.json` for section navigation.

**Tech Stack:** Fumadocs MDX content, top-level docs `meta.json`, `pnpm --filter @everr/docs types:check`.

---

### Task 1: Split Content Into Section Pages

**Files:**
- Delete: `packages/docs/content/docs/getting-started.mdx`
- Create: `packages/docs/content/docs/getting-started/index.mdx`
- Create: `packages/docs/content/docs/getting-started/opentelemetry.mdx`
- Create: `packages/docs/content/docs/getting-started/verify.mdx`
- Create: `packages/docs/content/docs/getting-started/ci.mdx`
- Create: `packages/docs/content/docs/getting-started/meta.json`

- [ ] **Step 1: Replace the single page with a folder section**

Move the install, notification, and skills content to `index.mdx`; move TypeScript/Rust OpenTelemetry setup to `opentelemetry.mdx`; move local telemetry checks to `verify.mdx`; move GitHub Action and advanced investigations to `ci.mdx`.

- [ ] **Step 2: Add section metadata**

Create `meta.json` with:

```json
{
  "title": "Getting Started",
  "pages": ["index", "opentelemetry", "verify", "ci"]
}
```

### Task 2: Verify Navigation

**Files:**
- Read: `packages/docs/content/docs/meta.json`
- Read: `packages/docs/content/docs/index.mdx`

- [ ] **Step 1: Confirm top-level navigation still points at the section**

Run:

```bash
rg -n '"getting-started"|/docs/getting-started' packages/docs/content/docs/meta.json packages/docs/content/docs/index.mdx
```

Expected: matches in both files.

- [ ] **Step 2: Confirm child page links are present**

Run:

```bash
rg -n '/docs/getting-started/(opentelemetry|verify|ci)' packages/docs/content/docs/getting-started
```

Expected: matches from overview cards and next-step links.

### Task 3: Verify Docs Build

**Files:**
- Read: `packages/docs/content/docs/getting-started/**/*.mdx`
- Read: `packages/docs/content/docs/getting-started/meta.json`

- [ ] **Step 1: Run docs typecheck**

Run:

```bash
pnpm --filter @everr/docs types:check
```

Expected: `fumadocs-mdx` and `tsc --noEmit` pass.

- [ ] **Step 2: Do not stage unrelated dirty docs work**

Run:

```bash
git status --short
```

Expected: report the split files and existing dirty docs work separately in the final response.
