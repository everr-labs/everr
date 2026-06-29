---
name: everr-write-runbooks
description: Use when creating, editing, reading, or applying an Everr runbook — markdown docs with embedded visualizations, the Runbook YAML spec, ```panel blocks, or investigating with an existing runbook's queries. The legacy `kind: Notebook` and `.notebook.yaml` are still accepted for back-compat.
---

# Writing Everr Runbooks

An Everr **runbook** is an as-code markdown document — an operational runbook, an agent skill, or an investigation doc — with dashboard visualizations embedded directly in the prose. A runbook is one `kind: Runbook` YAML file plus the `.md` files it points at. You reconcile it into Everr with `everr apply`, and it renders read-only in the webapp at `/runbooks/<project>/<slug>`.

> **Back-compat:** `kind: Notebook` is still accepted as an alias for `kind: Runbook`, and the `.notebook.yaml` suffix is still recognized (apply routes by `kind:`, not by extension). Prefer `kind: Runbook` and `.runbook.yaml` for new content.

Runbooks live in the **same apply tree as dashboards** and reuse the exact same panel, variable, and query model. This skill covers the runbook-specific schema and the ```panel embed syntax; for everything about panels, queries, visualizations, and variables, defer to the **`everr-write-dashboards`** skill — a panel object inside a runbook **is** a dashboard panel, byte for byte.

## Reading a runbook as an agent

The `.md` source on disk is the canonical artifact. **There is no fetch/get command** — agents run on the user's machine and read the source files directly with the normal file tools. To investigate with a runbook, open its `.md` file(s).

Each ```panel fence contains a runnable panel whose query is **ClickHouse SQL**. To use a runbook's panel during an investigation, extract the `query:` from the fence (or from the panel it `ref:`s in the YAML) and run or adapt it — via `everr cloud query "<sql>"` or the **`everr-use-telemetry`** skill. Queries use `{from:String}`/`{to:String}`/`{step:UInt32}` time params and `$variable` tokens; substitute concrete values when running ad hoc.

## The Runbook YAML schema

```yaml
kind: Runbook
metadata:
  name: high-error-rate          # slug + URL segment; set it explicitly. File stem mirrors it: high-error-rate.runbook.yaml
  project: demo                  # optional; defaults to "default"; namespaces identity + URL
spec:
  display:
    name: "High error rate runbook"
    description: "Triage steps for 5xx spikes"
  duration: 24h                  # optional; seeds the time-range picker (same as dashboards)
  refreshInterval: 1m            # optional; seeds auto-refresh
  variables: [ ... ]             # optional; identical schema to dashboard variables
  panels:                        # optional; shared panels referenced from markdown via `ref:`
    error-rate:
      kind: Panel
      spec: { ... }              # exactly a dashboard Panel spec
  markdown:                      # REQUIRED — the index page
    file: ./high-error-rate.runbook.md  # path relative to this YAML; inlined by the CLI at apply time
    # or: inline: |              # literal markdown instead of a file
    #   # High error rate
    #   ...
  pages:                         # optional; recursive child pages
    - name: triage               # page slug; unique among its siblings
      display: { name: Triage }
      markdown: { file: ./triage/index.md }
      pages:                     # pages nest arbitrarily deep
        - name: network
          markdown: { file: ./triage/network.md }
    - name: rollback
      markdown: { file: ./rollback.md }
```

Rules:

- **`spec.markdown` is required.** It is the index page (and the entire runbook when there are no child pages). There is no implicit "first page is the default."
- **`spec.pages` is optional and recursive.** Each page has `name` (slug, **unique among its siblings**), optional `display`, **required** `markdown`, and optional nested `pages`. The viewer URL joins page names: `/runbooks/<project>/<slug>/triage/network`.
- **`markdown` is `{ file: <path> }` or `{ inline: <string> }`.** `file:` paths resolve **relative to the YAML** and must stay **inside the apply directory**. The CLI reads each file and replaces it with `inline:` content before applying — the server only ever stores the inline form. A missing file fails the apply, naming both the YAML and the markdown path.
- **Link between pages** with a relative path to the sibling page's `.md` file (resolved against the current file, e.g. `[Triage](./triage.md)` or `[Network](./triage/network.md)`), or by the page's path (`[Triage](triage)`, `[Network](triage/network)`). The viewer rewrites these into in-app navigation. Absolute (`/...`) and external (`http(s):`, `mailto:`) URLs are left untouched.
- **`spec.variables` and `spec.panels` are the dashboard schema, reused verbatim.** Variables interpolate `$name` into panel queries server-side, identically to dashboards.

## The two ```panel embed forms

A runbook page embeds a visualization with a fenced ```panel block whose body is YAML. There are two forms, discriminated by shape. Every form takes an optional top-level `height:` in pixels (**80–2000, default 350**).

**1. Inline one-off panel** — a full `kind: Panel` object, defined right in the markdown:

````markdown
```panel
kind: Panel
height: 280
spec:
  display: { name: Error rate }
  plugin:
    kind: TimeSeriesChart
    spec: { unit: "%", showLegend: true }
  queries:
    - kind: ClickHouseSQL
      spec:
        plugin:
          kind: ClickHouseSQL
          spec:
            query: |
              SELECT toStartOfInterval(Timestamp, INTERVAL {step:UInt32} SECOND) AS ts,
                     countIf(StatusCode = 'Error') / count() * 100 AS error_pct
              FROM traces
              WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
              GROUP BY ts
              ORDER BY ts
```
````

**2. Reference to a shared panel** — `ref:` names a key in this runbook's `spec.panels`:

````markdown
```panel
ref: error-rate
height: 200
```
````

## Apply semantics

Runbooks reconcile through the **same apply tree as dashboards**: one `everr.yaml` manifest at the directory root declares a stable `repoid`, and one `everr apply <dir>` reconciles **one desired state across all kinds**. Applying a directory **prunes the repoid's runbooks AND dashboards that are not present in the tree** — delete-by-default, per kind. So **never split one repoid across two apply directories**; put all of a repoid's dashboards and runbooks under a single tree. By convention that tree is an `everr/` directory at your repo root with one kind-suffixed file per resource: runbooks are `*.runbook.yaml`, dashboards `*.dashboard.yaml`, alerts `*.alert.yaml`, and each runbook's `markdown.file` targets sit alongside.

```
everr/
  everr.yaml                       # REQUIRED manifest — declares the repoid (reconcile scope)
  checkout-api.dashboard.yaml      # a Dashboard
  high-error-rate.runbook.yaml     # a Runbook
  high-error-rate.runbook.md       # referenced by the runbook's `markdown.file`
  high-error-rate.alert.yaml       # an AlertRule (may share a stem with its runbook)
```

`everr/everr.yaml`:

```yaml
repoid: "2f8e3f90-9d1c-5d5f-a0f9-2d8e7f4a25d1"
```

The `.runbook.yaml` suffix is a human-facing convention — apply routes documents by their `kind:` field, and the slug always comes from `metadata.name`. (The legacy `.notebook.yaml` suffix is still recognized.) Files are flat in `everr/` by convention; subdirectories are optional and become folder paths in the UI. Run it the same way as dashboards:

```sh
everr apply ./everr --dry-run     # preview; writes nothing
everr apply ./everr               # prints the destination org, then confirms
```

Validation is **strict at apply time**, with precise messages and paths:

- Malformed fence YAML, a `ref:` to a missing shared panel, or invalid panel/visualization options **fail the apply**.
- Inline and `ref:` panel specs are validated against the visualization registry, exactly like dashboard panels.

## Panels and queries are dashboards

Panel objects inside a runbook are exactly dashboard panels — same `plugin.kind` set, same double-`ClickHouseSQL` query structure, same `{from:String}`/`{to:String}`/`{step:UInt32}` params and `$variable` interpolation. **Do not duplicate or re-derive panel rules here.** For visualization kinds, their `spec` options, SQL/bucketing rules, and variables, use the **`everr-write-dashboards`** skill. Discover real ClickHouse columns before writing queries (`everr cloud query "DESCRIBE TABLE traces"` or the `everr-use-telemetry` skill) — do not invent column names.
