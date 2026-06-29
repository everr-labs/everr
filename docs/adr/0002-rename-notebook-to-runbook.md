# Rename Notebook to Runbook

Originally "Notebook" was the genus (an as-code markdown doc) and "Runbook" was one of its use cases, alongside "agent skill" and "investigation doc". In practice the documents are runbooks, so we promoted "Runbook" to be the single umbrella concept and dropped the genus/species split. We rename internally — code, DB table/columns, and the `/notebooks` routes all change to "runbook" — but we keep backward compatibility on user config files: `kind: Notebook` is accepted as a synonym for `kind: Runbook`, and the `.notebook.yaml` extension stays recognized, so existing applied configs keep working without edits.

## Consequences

- DB migration required to rename the `notebooks` table, its indexes, and the `notebook_project` / `notebook_slug` alert columns.
- Config parsing must treat `kind: Notebook` ≡ `kind: Runbook` and accept both `.notebook.yaml` and `.runbook.yaml`; `Runbook` is canonical in new/emitted output.
- Bookmarked `/notebooks/...` URLs break (no redirect shim).
