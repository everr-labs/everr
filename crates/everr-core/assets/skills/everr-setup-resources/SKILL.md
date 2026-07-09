---
name: everr-setup-resources
description: Use when creating, editing, or applying Everr as-code resources (dashboards, runbooks, alert rules), Perses-format dashboard YAML, panels, ClickHouse queries, ```panel blocks, AlertRule YAML, the optional everr.yaml manifest, the `everr apply` CLI, or branch previews (`everr apply --preview`).
---

## Startup Access

Authoring resources is just editing files. Two things need access:

- **`everr apply`** talks to your Everr host. Allow production network `https://app.everr.dev` and filesystem read of `~/Library/Application Support/everr/session.json` (and `session-dev.json`) and their parent directory. Apply uses your `everr cloud login` session, or `EVERR_API_KEY` for CI (the deprecated alias `EVERR_API_TOKEN` still works).
- **Writing correct queries** means knowing your real ClickHouse columns. Discover them with `everr cloud query "DESCRIBE TABLE traces"` (or sample rows), or use the `everr-use-telemetry` skill. **Do not invent metric/label/column names.**

# Setting Up Everr Resources

Everr resources are **as-code**: dashboards, runbooks, and alert rules are YAML files on disk, reconciled into Everr with `everr apply`. The files are the source of truth.

## Rule Loading

Always read the relevant rule files before authoring or editing a resource. Load the minimum guidance for the resource kind being changed.

| Rule | Description |
| --- | --- |
| `queries` | The shared panel and query model: ClickHouse SQL, time params, bucketing, variables, data shapes. Read for any dashboard or runbook work. |
| `dashboards` | Dashboard schema, grid layout, worked example |
| `runbooks` | Runbook schema, pages, ```panel embeds, reading runbooks as an agent |
| `alerts` | AlertRule schema, alert design, thresholds, notification messages, verification |
| `timeseries`, `barchart`, `table`, `statchart`, `gaugechart`, `geomap`, `treemap`, `statetimeline`, `statushistory`, `heatmap`, `nodegraph` | One file per visualization kind: the complete option set, expected data shape, and footguns |

For a dashboard task read `queries`, `dashboards`, and the viz rules you use. For a runbook read `queries` and `runbooks`. For an alert read `alerts`, plus `runbooks` when creating the linked runbook.

## File Layout And The Repo Identity

`everr apply <dir>` reconciles a directory of declarations. By convention that directory is `everr/` at your repo root. The apply identity (the `repoid`) is inferred from the repository's `origin` remote, normalized to `host/owner/repo`. No manifest is needed. Name each file by its kind, with the slug as the stem:

```
everr/
  everr.yaml                       # optional explicit repoid override
  checkout-api.dashboard.yaml      # a Dashboard
  high-error-rate.runbook.yaml     # a Runbook
  high-error-rate.runbook.md       # referenced by the runbook's `markdown.file`
  high-error-rate.alert.yaml       # an AlertRule (may share a stem with its runbook)
  platform/
    db-health.dashboard.yaml       # folder "platform" (from the directory name)
```

An optional `everr.yaml` (or `.yml`) at the apply root overrides the inferred identity. It accepts exactly one key:

```yaml
# everr/everr.yaml (optional override)
repoid: "my-explicit-id"
```

The `repoid` is the **apply ownership boundary**: `everr apply` reconciles exactly the resources previously applied under this id and nothing else. Use one stable id per repository; never reuse a repoid across unrelated repos, and never change it for an existing one (that orphans everything applied under the old id). It is the only key the manifest accepts. Use the manifest for local-only repositories, non-git directories, or when you need to pin an explicit name.

Apply routes each document by its `kind:` field, so the `.dashboard.yaml`/`.runbook.yaml`/`.alert.yaml` suffixes are a human-facing naming convention, not something the CLI parses. The slug always comes from `metadata.name`. Files are flat in `everr/` by convention; subdirectories are optional and become folder paths in the UI. There are no folder objects.

## Apply Workflow

```sh
everr apply ./everr --preview     # always stage into a preview first; live state untouched
everr apply ./everr               # prints the destination org, then asks to confirm
```

Apply discovers all `.yaml`/`.yml` files under the directory, classifies them by `kind`, and reconciles creates, updates, and deletes. It is **declarative and delete-by-default within the `repoid`**: new files are created, changed files updated, removed files **deleted** (alerts are soft-deleted, history is preserved). This spans **all resource kinds**: the tree is the complete desired state for that repoid, so applying a dashboards-only directory also prunes runbooks and alerts previously applied under the same repoid. Never split one repoid across two apply directories. Re-applying with no changes prints `Nothing to apply.`

In CI, set `EVERR_API_KEY` and pass `--yes`. Only deploy to production when the user is satisfied with the changes.

## Previews

To share work-in-progress in the real UI without touching the live state, apply into a preview:

```sh
everr apply ./everr --preview            # named after the current git branch
everr apply ./everr --preview pr-142     # explicit name (required in CI / detached HEAD)
```

A preview is a full copy of the tree under a name, overlaid on the live state in the UI. Apply prints a shareable `Preview:` link (the UI reads `?preview=<name>`); anyone in the org can open it and sees each resource badged as added, changed, removed, or unchanged against live. A "conflict" badge means the preview adds a (project, slug) that another repo already owns live, so shipping it would need `--adopt`.

- Live state is never touched. Each (repoid, name) preview is its own reconcile scope with the same declarative delete-by-default semantics; re-applying the branch updates it in place.
- Previews skip the confirmation prompt and never need `--yes`: they are disposable.
- Preview alert rules evaluate and show firing/ok in the UI, but never send notifications.
- There is no delete step. A preview expires automatically once it has not been re-applied for the retention window (default 7 days); re-applying refreshes it. To ship it, merge the branch and run a normal live apply.

Never stage changes with a scratch repoid or a second apply directory; `--preview` exists for exactly that.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| No `origin` remote and no `everr.yaml` manifest | Apply infers the repoid from the `origin` remote. If there is neither, create `everr.yaml` with a `repoid:` or add a remote. An `everr.yaml` always wins over the inferred slug. |
| Empty `repoid` or reusing across repos | Use one stable id per repository; a UUID is a good default for new repos |
| `everr dashboard apply -f file.yaml` or applying a single file | The command is `everr apply <dir>` against a directory |
| Splitting one repoid across two apply directories | One tree per repoid; apply prunes everything not in the tree, across all kinds |
| Inventing metric/label/column names | Discover real columns with `everr cloud query "DESCRIBE TABLE traces"` or the `everr-use-telemetry` skill |
| Staging unreviewed changes via a scratch repoid, or sharing them with only `--dry-run` output | `everr apply --preview` deploys a viewable copy into the UI without touching live |
| Trying to delete or clean up a preview | Previews expire on their own after the retention window; just stop applying them |
