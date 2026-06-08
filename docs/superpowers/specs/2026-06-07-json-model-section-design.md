# Settings JSON Model Section + User-Chosen Slugs — Design

_Date: 2026-06-07. Branch: `gio/perses-dashboard-route` (extends the settings page; see `2026-06-06-dashboard-settings-page-design.md` and `2026-06-07-settings-entry-point-design.md`)._

Adds a third settings section that shows the full Perses dashboard model (`{ kind, metadata, spec }`) in a JSON editor with draft-based edits, and makes `metadata.name` (the URL slug) user-editable: staged via JSON Apply, persisted through the Save flow (rename for saved dashboards, chosen slug at creation for drafts).

## Decisions already made (do not re-litigate)

1. **Full model, everything editable** — including `metadata.name`. `kind` must remain `"Dashboard"` (validation error otherwise).
2. **Save-integrated rename (approach A):** JSON Apply only patches the store (Apply = stage, Save = persist, like every other section). The slug change happens inside the existing save/create server fns, atomically with the spec write. No separate rename-on-Apply server call.
3. **Drafts accept slug edits too** — no "assigned on first save" rejection. `new.tsx`'s name-sentinel store guard is replaced by an explicit draft flag.
4. **Reserved slug:** `"new"` is rejected as a user-chosen slug (route collision with `/dashboards/new`).

## 1. Schema — `data/dashboards/schema.ts`

- `export const dashboardSlugSchema`: `z.string().min(1).max(200).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/).refine((s) => s !== "new", ...)` with clear messages ("lowercase letters, digits and hyphens; cannot start/end with a hyphen", `"new" is reserved`).
- `export const dashboardModelSchema`: `z.object({ kind: z.literal("Dashboard"), metadata: z.object({ name: z.string().min(1).max(200) }), spec: dashboardSpecSchema })` — validates the JSON section's parsed document. `metadata.name` is deliberately LOOSE here: an untouched document echoes back the current slug (or the `"new"` draft sentinel), which must always re-validate. The strict `dashboardSlugSchema` applies only to a CHANGED name (checked in the JSON section on Apply) and to the server inputs (authoritative). (The existing `Dashboard` TS interface stays; the zod schema is for runtime validation only.)
- `saveDashboardInput` gains `newSlug: dashboardSlugSchema.optional()`.
- `createDashboardInput` gains `slug: dashboardSlugSchema.optional()`.
- Existing generated 12-char slugs already match the pattern; `saveDashboardInput.slug` (the lookup key) stays as-is.

## 2. Server — `data/dashboards/server.ts`

- `saveDashboard`: when `newSlug` is present and differs from `slug`, update `slug` AND `spec` in the same `db.update` (single statement — already atomic). Map unique-constraint violation on the slug column to a friendly error (`A dashboard with slug "<newSlug>" already exists`) using the existing unique-violation mapping approach. Return `{ slug: finalSlug }` (already returns `slug` — now the new one).
- `createDashboard`: when `slug` is provided, use it instead of generating; on unique violation, do NOT retry (retry loop is for generated slugs only) — map to the same friendly error. When absent, behavior unchanged.

## 3. Store — `data/dashboards/dashboard-store.ts`

- New `sourceSlug: string | null` state (default null): the slug this dashboard was loaded from — the DB row identity. `null` means unsaved draft (subsumes the earlier `isDraft` idea). `setDashboard(dashboard, opts?: { draft?: boolean })` sets `sourceSlug = opts?.draft ? null : dashboard.metadata.name`. `markSaved` re-syncs `sourceSlug = dashboard.metadata.name` (after a successful rename/create the staged slug becomes the identity). `reset` clears it to null. All other actions leave it untouched.
- `new.tsx` seeds `setDashboard(EMPTY_DASHBOARD, { draft: true })`; its guard becomes `if (!dashboard || sourceSlug !== null)` — drafts survive `metadata.name` edits; stale saved dashboards still get cleared.
- `$dashboardId.tsx` bootstrap guard becomes `if (!dashboard || sourceSlug !== dashboardId)` (was `metadata.name !== data.metadata.name`) — otherwise returning to the dashboard with a staged rename would silently replace the dirty store with server data, losing all staged edits.

## 4. JSON section — `components/dashboards/settings-json-section.tsx`

- Third nav entry on the settings page: General | Variables | **JSON**. `SettingsSelection` gains `{ kind: "json" }`; the existing confirm-discard guard applies (the section reports `hasUnapplied` like the variable form).
- The editor shows `JSON.stringify({ kind, metadata, spec }, null, 2)` of the store dashboard; draft-based, remounted via `key` on selection change (re-serialized after Apply so the user sees the committed/normalized state).
- **Apply:** `JSON.parse` → `dashboardModelSchema.safeParse` → if `metadata.name` differs from the current identity (`sourceSlug ?? "new"`), additionally validate it with `dashboardSlugSchema` → `patchDashboard(parsed)` (marks dirty; metadata.name changes are staged in the store). Inline errors: parse failure (message), validation failure (first issue's path + message). Errors clear on edit.
- Muted caption: slug changes take effect on Save; the page URL updates then.

## 5. JSON editor component

- Refactor `sql-editor.tsx`: extract the generic CodeMirror mount (theme, refs, updateListener, placeholder) into `components/dashboards/code-editor.tsx` with a `language: Extension` prop; `SqlEditor` becomes a thin wrapper passing the ClickHouse dialect. New `JsonEditor` wrapper passes `json()` from **`@codemirror/lang-json`** (new dependency). No behavior change for the panel editor or the variable form.

## 6. Save flows (both sites)

- **Settings page Save** (`dashboard-settings-page.tsx`): `slug: sourceSlug`, `newSlug: dashboard.metadata.name !== sourceSlug ? dashboard.metadata.name : undefined`. On success: `markSaved()`, and when the returned slug differs from the route param, `navigate({ to: "/dashboards/$dashboardId/settings", params: { dashboardId: returnedSlug }, replace: true, search: keepVars })`. Save errors (e.g. slug collision) surface inline near the Save button (small destructive text), not a toast.
- **Dashboard grid Save** (`dashboard-grid.tsx`, saved dashboards): same `slug: sourceSlug` / `newSlug` derivation; on success with a changed slug, `navigate` (replace) to the new dashboard URL. The grid's kebab mutations (display-name rename / move / delete) and its `currentFolderId` lookup also switch from `dashboard.metadata.name` to `sourceSlug` (they operate on the DB row, whose identity is `sourceSlug` while a rename is staged).
- **Create flow** (`dashboard-grid.tsx` save dialog, `isNew`): pass `slug: dashboard.metadata.name === "new" ? undefined : dashboard.metadata.name`. Collision error shows in the save dialog (it already displays mutation errors or gains a small error line).
- Query invalidation: existing save/create invalidations cover the dashboard + list; rename additionally invalidates the old slug's `dashboardOptions` (or simply `removeQueries` for it).
- **Blocker prefixes must use the URL slug, not `metadata.name`:** with a staged slug change the two diverge until Save. The settings page already derives its prefix from the route param; `dashboard-grid.tsx`'s `dashboardPathPrefix` switches from `dashboard?.metadata.name` to the route slug (passed in or read from params) so intra-dashboard navigation stays exempt while a rename is staged.

## 7. Out of scope

- Editing other dashboards' JSON, import/export, JSON diffing, schema-aware autocomplete.
- Redirects from old slugs after rename (old links 404/error — accepted).
- Changing the generated-slug format or the rename(display-name)/move/delete kebab flows.

## 8. Testing

- `schema` tests: `dashboardSlugSchema` matrix (valid, uppercase, leading/trailing hyphen, `"new"`, >200 chars), `dashboardModelSchema` (wrong kind, missing metadata, bad spec).
- `server.test.ts`: saveDashboard with `newSlug` (renames + saves spec), collision → friendly error, no `newSlug` unchanged; createDashboard with chosen slug, chosen-slug collision (no retry, friendly error), without slug unchanged.
- `dashboard-store.test.ts`: `sourceSlug` set by `setDashboard` (saved + draft), re-synced by `markSaved`, cleared by `reset`.
- Browser: JSON section shows the model; bad JSON / wrong kind / bad slug → inline errors; spec edit via JSON → Apply → Save persists; slug edit → Save → URL updates (settings page) and dashboard URL after back; collision error inline; new-dashboard flow: JSON slug edit survives back-and-forth to `/dashboards/new`, create uses the chosen slug, collision shows in the dialog; confirm-discard on leaving JSON with un-applied edits.

## Context for implementers

- Key files: `schema.ts` (slug/model schemas, inputs), `server.ts` (`saveDashboard` ~107, `createDashboard`, unique-violation mapping used by create's retry loop), `dashboard-store.ts`, `new.tsx` (EMPTY_DASHBOARD + guard), `dashboard-settings-page.tsx` (nav, Save, selection type in `settings-variables-section.tsx`), `sql-editor.tsx`, `dashboard-grid.tsx` (handleSave + create mutation).
- `SettingsSelection` currently lives in `settings-variables-section.tsx`; adding `{ kind: "json" }` there is fine (or move the type to the page — implementer's call, keep it in one place).
- Conventions: conventional commits, no AI traces, never `tsx`, lefthook biome + fallow (order commits so new exports have consumers), never hand-edit `routeTree.gen.ts`, no Drizzle migration needed (no DB schema change — slug column exists).
- Tests: `cd packages/app && pnpm exec vitest run`; typecheck `pnpm typecheck`; desktop guard `cd packages/desktop-app && pnpm exec tsc --noEmit`. Suite baseline: 559.
- Browser protocol: dev server :5173 (reuse), playwright-core env at `/tmp/settings-verify` (auth state, dashboard slug `xfmezad9iug4`), `waitUntil: "load"`, CodeMirror via `.cm-content` click + keyboard.
