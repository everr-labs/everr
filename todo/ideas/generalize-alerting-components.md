# Generalize alerting components into @everr/ui / app-shared

## What
Survey of `packages/app/src/routes/_authenticated/_dashboard/alerts/-components/` for components worth generalizing or promoting into `@everr/ui`, scored 1-10 on genericity, evidence of duplication elsewhere in the repo, and effort/risk. Constraint that shapes several verdicts: `@everr/ui` has no `@tanstack/react-router` dependency, so anything rendering a router `Link` cannot move there without a render-prop indirection.

## Candidates by score

| Score | Component | Target | Why |
|---|---|---|---|
| 9 | `CcTableSkeleton` | `@everr/ui` | Zero domain coupling, and the same hand-rolled pattern (`space-y-2 px-3 py-2` + `Array.from` of Skeletons) exists in `users-management.tsx:56`, `api-keys.tsx:55`, `tests-overview.tsx`, and the runs trace pages. One trivial component deletes four copies. |
| 7 | `Pill` + `LabelSet` | `@everr/ui` | Pure presentation of key=value chips over `Record<string, string>`, no cc types. Chips are design-system vocabulary; logs/traces/errors attribute displays are natural consumers. (`Conditions` stays: coupled to `CcMatcher`/`ccOpSymbol`.) |
| 7 | `CcStatusDot` | `@everr/ui` | Pulse-dot companion to `tone.ts`, which already lives in ui. CI run status and live indicators are obvious second consumers. Move the dot taking a ui `Tone` directly; keep the cc `TONE_KIND` severity mapping in the app. |
| 6 | `CcPageIntro` | app-shared | Every section hand-rolls its page header differently: api-keys `text-xl font-bold`, tests-overview `text-2xl font-bold`, runbooks `text-lg font-semibold`, alerting `text-sm font-semibold`. Unifying is a real consistency win but requires picking one heading scale for the app first (a design decision, not just a refactor). |
| 5 | `CcDrawer` | `@everr/ui` | Clean header/body/footer scaffold over ui's own Sheet, zero domain coupling. Only Sheet-with-footer in the repo today; move the moment a second section wants a side drawer. |
| 5 | `ccFormatTs` | `@everr/ui/lib` | ui already has `formatting.ts` and `timestamp.ts`; a null-safe "RFC-3339 to locale string" belongs with them. Trivial, best done opportunistically. |
| 4 | `CcDisclosureTrigger` | `@everr/ui` | Styled `CollapsibleTrigger` (rotating chevron, boxed/bare variants) that would fit as a Collapsible companion, but only the alerts pages use disclosures this way today. |
| 4 | `CcEmptyState` | fold, don't move | Three empty-state layers already exist: ui's `Empty` primitives + `RetryError`, app's `ResourceEmptyState`, and this wrapper. Promote one thin default into ui or use `Empty` directly; don't add a fourth variant. |
| 3 | `CcBackLink`, `CcRunbookLink`, `SectionCard` | stay | All render router `Link`s, so ui is off the table without an indirection costing more than the ~20 lines each saves. Generalize app-side only if another section grows the same pattern. |
| 3 | `CcPauseToggle` | stay | The confirm-dialog-around-an-action shape could become a generic `ConfirmButton`, but ui's AlertDialog primitives already make that easy, and pause/resume vocabulary is alerting's. |
| 3 | `CcQueryError` | stay | The shell looks generic but the value is `ccErrorInfo`'s cc error taxonomy (unavailable vs bad request); ui's `RetryError` covers the generic case. |

## Not candidates
`budget-bar` (thin skin over ui's `Meter`; formatting/thresholds are SLO semantics), `CcSloTierBadge`, `pipeline-strip`, `triage-board`, the builders, and `slo-budget-chart`: all domain logic that belongs where it is.

## Sketch
Start with the top three (`CcTableSkeleton`, `Pill`/`LabelSet`, `CcStatusDot`), converting the four hand-rolled skeleton sites in the same pass; that's the chunk with proven payoff and near-zero risk. `CcPageIntro` unification is worth its own small design pass across sections.

## Related
Surfaced after moving all cc components into the route-private `alerts/-components/` folder; the only cross-boundary import left is `slo-budget-chart` reaching into `components/dashboards/visualizations/` (see chart-tooltip-content-duplication for the tooltip half of that).
