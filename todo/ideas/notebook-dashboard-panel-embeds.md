# Notebook embeds of dashboard panels

## What
Bring back a way to embed a panel from an existing dashboard into a notebook's
markdown, via a ```panel fence like:

```panel
dashboard: demo/web-http-overview
panel: request-rate
```

This was implemented and then removed because the interaction with notebook
variables and apply-time validation got too complicated (see Notes). Any
revival needs to solve those problems up front, not bolt them on after.

## Why
Notebooks (runbooks) want to reference the canonical, already-maintained panel
on a service dashboard instead of re-authoring it inline or duplicating its
query as a shared `spec.panels` entry. Keeps one source of truth for the query
and lets a runbook link straight to the live panel.

## Who
Runbook authors who want their notebook to show the same panel an on-call
engineer would open on the service dashboard.

## Rough appetite
medium

## Notes — why the first cut was removed
- **Variable scoping.** The embedded panel was rendered inside the notebook's
  `DashboardProvider`, so it picked up the *notebook's* variable defaults/values
  rather than the source dashboard's. A panel that used variables defined on its
  own dashboard evaluated against the wrong (or missing) variables — missing-
  variable errors or silently wrong queries. A real fix has to evaluate the
  embedded panel against the source dashboard's variable context, not the host
  notebook's.
- **Apply-time validation gap.** The `dashboard:`+`panel:` target was *not*
  cross-validated at apply (the target dashboard might be applied in the same
  run), so a dangling reference only surfaced as a render-time error card. Either
  validate within a single multi-kind apply transaction or accept and document
  the late failure.
- The inline (`kind: Panel`) and `ref:` (notebook's own `spec.panels`) embed
  forms were kept — they don't have the cross-dashboard variable/validation
  problems. This idea is only about the cross-dashboard `dashboard:` form.

## Pointers (at time of removal)
- Parser/forms: `packages/app/src/data/notebooks/embed.ts`
- Renderer: `packages/app/src/components/notebooks/notebook-panel-embed.tsx`
  (`DashboardEmbed` rendered the fetched dashboard's panel in the notebook
  provider — the variable-scope bug lived here).
- Apply validation: `packages/app/src/data/notebooks/desired.ts` (`validateFences`).
