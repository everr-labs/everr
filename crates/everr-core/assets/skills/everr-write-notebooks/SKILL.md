---
name: everr-write-notebooks
description: Use when creating, editing, reading, or applying an Everr notebook — markdown runbooks/skills with embedded visualizations, the Notebook YAML spec, ```panel blocks, or investigating with an existing runbook's queries.
---

# Writing Everr Notebooks

An Everr **notebook** is an as-code markdown document — a runbook, an agent skill, or an investigation doc — with dashboard visualizations embedded directly in the prose. A notebook is one `kind: Notebook` YAML file plus the `.md` files it points at. You reconcile it into Everr with `everr apply`, and it renders read-only in the webapp at `/notebooks/<project>/<slug>`.

Notebooks live in the **same apply tree as dashboards** and reuse the exact same panel, variable, and query model. This skill covers the notebook-specific schema and the ```panel embed syntax; for everything about panels, queries, visualizations, and variables, defer to the **`everr-write-dashboards`** skill — a panel object inside a notebook **is** a dashboard panel, byte for byte.

## Reading a notebook as an agent

The `.md` source on disk is the canonical artifact. **There is no fetch/get command** — agents run on the user's machine and read the source files directly with the normal file tools. To investigate with a runbook, open its `.md` file(s).

Each ```panel fence contains a runnable panel whose query is **ClickHouse SQL**. To use a runbook's panel during an investigation, extract the `query:` from the fence (or from the panel it `ref:`s in the YAML) and run or adapt it — via `everr cloud query "<sql>"` or the **`everr-use-telemetry`** skill. Queries use `{from:String}`/`{to:String}`/`{step:UInt32}` time params and `$variable` tokens; substitute concrete values when running ad hoc.

## The Notebook YAML schema

```yaml
kind: Notebook
metadata:
  name: high-error-rate          # slug; the URL segment. Defaults to the filename.
  project: demo                  # optional; defaults to "default"; must be in everr.yaml
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
    file: ./high-error-rate.md   # path relative to this YAML; inlined by the CLI at apply time
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

- **`spec.markdown` is required.** It is the index page (and the entire notebook when there are no child pages). There is no implicit "first page is the default."
- **`spec.pages` is optional and recursive.** Each page has `name` (slug, **unique among its siblings**), optional `display`, **required** `markdown`, and optional nested `pages`. The viewer URL joins page names: `/notebooks/<project>/<slug>/triage/network`.
- **`markdown` is `{ file: <path> }` or `{ inline: <string> }`.** `file:` paths resolve **relative to the YAML** and must stay **inside the apply directory**. The CLI reads each file and replaces it with `inline:` content before applying — the server only ever stores the inline form. A missing file fails the apply, naming both the YAML and the markdown path.
- **Link between pages** with a relative path to the sibling page's `.md` file (resolved against the current file, e.g. `[Triage](./triage.md)` or `[Network](./triage/network.md)`), or by the page's path (`[Triage](triage)`, `[Network](triage/network)`). The viewer rewrites these into in-app navigation. Absolute (`/...`) and external (`http(s):`, `mailto:`) URLs are left untouched.
- **`spec.variables` and `spec.panels` are the dashboard schema, reused verbatim.** Variables interpolate `$name` into panel queries server-side, identically to dashboards.

## The three ```panel embed forms

A notebook page embeds a visualization with a fenced ```panel block whose body is YAML. There are three forms, discriminated by shape. Every form takes an optional top-level `height:` in pixels (**80–2000, default 350**).

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

**2. Reference to a shared panel** — `ref:` names a key in this notebook's `spec.panels`:

````markdown
```panel
ref: error-rate
height: 200
```
````

**3. Dashboard panel embed** — `dashboard: <project>/<slug>` plus `panel: <key>` pulls a panel from an existing dashboard:

````markdown
```panel
dashboard: demo/web-http-overview
panel: request-rate
```
````

The dashboard embed resolves **at view time**, so it stays live and in sync with the source dashboard, and the rendered panel header carries a link that opens `/dashboards/demo/web-http-overview`.

**Embed variable-free dashboard panels** (or declare matching `spec.variables` in the notebook): a dashboard panel whose query uses `$variables` only interpolates variables the *notebook* defines — an undefined `$variable` reaches ClickHouse verbatim and the embed errors.

## Apply semantics

Notebooks reconcile through the **same apply tree as dashboards**: one `everr.yaml` manifest at the directory root declares the projects, and one `everr apply <dir>` reconciles **one desired state across all kinds**. Applying a directory that declares a project **prunes that project's notebooks AND dashboards that are not present in the tree** — delete-by-default, per kind. So **never split one project across two apply directories**; put all of a project's dashboards and notebooks under a single tree.

```
docs/
  everr.yaml                 # REQUIRED manifest — declares the reconcile scope
  checkout-api.yaml          # a Dashboard
  high-error-rate.yaml       # a Notebook
  high-error-rate.md         # referenced by the notebook's `markdown.file`
  triage/
    index.md
    network.md
```

`docs/everr.yaml`:

```yaml
projects:
  - demo
```

Run it the same way as dashboards:

```sh
everr apply ./docs --dry-run     # preview; writes nothing
everr apply ./docs               # prints the destination org, then confirms
```

Validation is **strict at apply time**, with precise messages and paths:

- Malformed fence YAML, a `ref:` to a missing shared panel, or invalid panel/visualization options **fail the apply**.
- Inline and `ref:` panel specs are validated against the visualization registry, exactly like dashboard panels.
- A **`dashboard:` embed is NOT cross-checked at apply** — the target dashboard may be applied in the same run. A dangling dashboard embed renders an inline **error card** in the viewer instead of failing the apply.

## Panels and queries are dashboards

Panel objects inside a notebook are exactly dashboard panels — same `plugin.kind` set, same double-`ClickHouseSQL` query structure, same `{from:String}`/`{to:String}`/`{step:UInt32}` params and `$variable` interpolation. **Do not duplicate or re-derive panel rules here.** For visualization kinds, their `spec` options, SQL/bucketing rules, and variables, use the **`everr-write-dashboards`** skill. Discover real ClickHouse columns before writing queries (`everr cloud query "DESCRIBE TABLE traces"` or the `everr-use-telemetry` skill) — do not invent column names.
