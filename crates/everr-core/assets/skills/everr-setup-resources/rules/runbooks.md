# Writing Everr Runbooks

An Everr **runbook** is an\markdown document with visualizations embedded directly in the prose.

Don't ask the user to (unless explicitly requested):
- run a SQL query themselves
- go to a given dashboard or check a telemetry manually

Instead, bake into the runbook visualizations needed to do the investigations/analysis steps.

A runbook is one `kind: Runbook` YAML file plus the `.md` files it points at, named `<slug>.runbook.yaml` in the apply tree. 
It renders read-only in the webapp at `/runbooks/<project>/<slug>`.

Runbooks reuse the exact same panel, variable, and query model as dashboards — a panel object inside a runbook **is** a dashboard panel, byte for byte. Read `rules/queries.md` for that model; this file covers the runbook-specific schema and the ```panel embed syntax.

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
  pages:                         # optional; recursive child pages
    - name: triage               # page slug; unique among its siblings
      display: { name: Triage }
      markdown: { file: ./triage/index.runbook.md }
      pages:                     # pages nest arbitrarily deep
        - name: network
          markdown: { file: ./triage/network.runbook.md }
    - name: rollback
      markdown: { file: ./rollback.runbook.md }
```

Rules:

- **`spec.markdown` is required.** It is the index page (and the entire runbook when there are no child pages). There is no implicit "first page is the default."
- **`spec.pages` is optional and recursive.** Each page has `name` (slug, **unique among its siblings**), optional `display`, **required** `markdown`, and optional nested `pages`. The viewer URL joins page names: `/runbooks/<project>/<slug>/triage/network`.
- **`markdown` is `{ file: <path> }`.** Always write each page as its own markdown file next to the YAML, named with the `.runbook.md` suffix — never inline markdown in the YAML. Paths resolve **relative to the YAML** and must stay **inside the apply directory**. The CLI reads each file and inlines its content at apply time. A missing file fails the apply, naming both the YAML and the markdown path.
- **Link between pages** with a relative path to the sibling page's markdown file (resolved against the current file, e.g. `[Triage](./triage.runbook.md)` or `[Network](./triage/network.runbook.md)`), or by the page's path (`[Triage](triage)`, `[Network](triage/network)`). The viewer rewrites these into in-app navigation. Absolute (`/...`) and external (`http(s):`, `mailto:`) URLs are left untouched.
- **`spec.variables` and `spec.panels` are the dashboard schema, reused verbatim.** Variables interpolate `$name` into panel queries server-side, identically to dashboards.
- **Never put raw ```sql blocks in the prose for someone to run by hand.** If a query is worth showing, embed it as a ```panel — panels render live against the selected time range, while SQL blocks in prose are dead text.

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

Runbooks reconcile through the same apply tree as dashboards and alerts — see the skill root for the manifest, file layout, and delete-by-default semantics. Validation is **strict at apply time**, with precise messages and paths:

- Malformed fence YAML, a `ref:` to a missing shared panel, or invalid panel/visualization options **fail the apply**.
- Inline and `ref:` panel specs are validated against the visualization registry, exactly like dashboard panels.
