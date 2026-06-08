# Dashboard Folders & Management — Design Spec

## Context

The dashboards feature supports creating, viewing, editing, and saving dashboards. The data layer for organization already exists — a `dashboard_folders` table with self-referencing `parent_id` (arbitrary nesting), a `folder_id` column on `dashboards`, and server fns for folder CRUD (`listFolders`, `createFolder`, `renameFolder`, `deleteFolder` with `cascade`/`move-to-root` modes) plus `deleteDashboard`. None of it is exposed in the UI: the `/dashboards` index is a flat card grid, and there is no way to rename, move, or delete a dashboard or folder from the app.

## Scope decisions

- **Full nesting**: folders can contain sub-folders to any depth, matching the schema.
- **Rename = display name only**: a dashboard's slug (URL identity) never changes. Rename updates `spec.display.name`.
- **Moving via context menu**: "Move to folder" opens a folder picker dialog. No drag & drop in this iteration.
- **Actions live in two places**: per-row kebab menus on the `/dashboards` index, and a kebab menu in the dashboard page toolbar.
- **Folder delete offers both modes**: "Move contents to root" and "Delete everything", matching the server API.
- **Folder at creation time**: the new-dashboard save dialog includes a folder picker; "New dashboard" from a folder's menu pre-selects that folder.
- **Index layout: tree list**. One hierarchical list with expandable folder rows replaces the card grid. Search flattens to matching items with folder paths.

## Data layer

### `packages/app/src/data/dashboards/server.ts`

| Change | Detail |
|--------|--------|
| `listDashboards` | Add `folderId` to the selected columns (currently returns `slug` + `name` only). |
| New `renameDashboard` | Input `{ slug, name }`. Read-modify-write of `spec.display.name` inside the handler, scoped to the org. Slug unchanged. |
| New `moveDashboard` | Input `{ slug, folderId: string \| null }`. Updates only the `folder_id` column. |
| New `moveFolder` | Input `{ folderId, parentId: string \| null }`. Re-parents a folder. Server-side cycle check: walk ancestors from the target `parentId`; reject if `folderId` is reached. |

Rationale for `renameDashboard`/`moveDashboard` as dedicated fns: the list page only holds `{ slug, name, folderId }`, and rename/move should not require round-tripping the full dashboard spec through the client.

Input validators live in `packages/app/src/data/dashboards/schema.ts` alongside the existing ones.

### `packages/app/src/data/dashboards/options.ts`

- `folderListOptions()` — query options for `listFolders`, key `["dashboard-folders"]` (the key the existing folder mutation hooks already invalidate).
- New mutation hooks following the existing toast-on-error pattern: `useRenameDashboard`, `useMoveDashboard`, `useMoveFolder`. Dashboard mutations invalidate the dashboard list key (and the affected `dashboardOptions(slug)` for rename); folder mutations invalidate `["dashboard-folders"]`.

No DB schema or migration changes.

## Tree building

### New `packages/app/src/data/dashboards/tree.ts`

Pure function `buildTree(folders, dashboards)` assembling the hierarchy client-side:

- Folders grouped by `parentId`, dashboards by `folderId`; root bucket = `null`.
- Sorting within each level: folders first, then dashboards, each alphabetical by name.
- Orphans (a `folderId`/`parentId` pointing at a non-existent folder) fall back to root rather than disappearing.

Unit-tested with vitest, colocated as `tree.test.ts` (same pattern as `convert.test.ts`).

## Index page (`/dashboards`)

### Rewritten `routes/_authenticated/_dashboard/dashboards/index.tsx` + new `components/dashboards/dashboard-tree.tsx`

- Queries `dashboardListOptions()` and `folderListOptions()`, feeds both into `buildTree`.
- **Folder row**: chevron (expand/collapse), folder icon, name, kebab menu. Collapsed by default. Expansion state is a `useState` `Set` of folder ids — no persistence.
- **Dashboard row**: dashboard icon, name linking to `/dashboards/$dashboardId`, slug in muted text, kebab menu.
- **Search**: non-empty query flattens the tree to matching dashboards *and* folders (case-insensitive name match), each row showing its folder path (e.g. `Production / API`). Clearing the search restores the tree.
- **Header**: existing "New Dashboard" button plus a "New Folder" button (opens the create-folder dialog, creating at root).
- **Empty states**: existing no-dashboards state retained; an expanded empty folder shows a muted "empty" hint row.

### Kebab menus (shadcn `DropdownMenu`)

| Row | Items |
|-----|-------|
| Folder | New dashboard, New subfolder, Rename, Move, Delete |
| Dashboard | Rename, Move to folder, Delete |

### Dialogs (shared, in `components/dashboards/`)

| Dialog | Behavior |
|--------|----------|
| `folder-picker.tsx` | Indented folder tree in a dialog with a "Root" entry. When moving a folder, the folder itself and all its descendants are disabled (client-side mirror of the server cycle check). |
| Rename dialog | Single text input; used for both folders and dashboards. |
| Delete dashboard | Confirm dialog showing the dashboard name. |
| Delete folder | Empty folder: simple confirm. Non-empty: shows content counts ("3 dashboards, 1 subfolder", computed from the already-loaded tree) and offers two explicit actions — **Move contents to root** and **Delete everything** (destructive button variant). |

## Dashboard page toolbar

In `components/dashboards/dashboard-grid.tsx`, a kebab menu next to the Save button, hidden when `isNew`:

- **Rename** — applies immediately via `renameDashboard` and updates the zustand store's `spec.display.name`, keeping the breadcrumb and any later Save consistent.
- **Move to folder** — opens the folder picker, calls `moveDashboard`.
- **Delete** — confirm dialog, then `deleteDashboard` and navigate to `/dashboards`.

All three reuse the index-page dialogs.

## New-dashboard flow

- The existing save-name dialog gains the folder picker, defaulting to Root. `saveDashboard` already accepts `folderId`.
- "New dashboard" from a folder's kebab navigates to `/dashboards/new?folder=<id>`; the search param pre-selects that folder in the picker.

## Error handling

- All mutations use the existing toast-on-error pattern.
- The folder name unique constraint (`org, parent, name`) surfaces as a server error → toast. No client-side pre-check in v1.
- `moveFolder` cycles are rejected server-side and prevented client-side via disabled picker rows.

## Verification

1. Create a folder at root, a subfolder inside it, and a dashboard inside the subfolder (via the folder's "New dashboard" → picker pre-selected).
2. Expand/collapse folders; confirm sorting (folders first, alphabetical).
3. Search: matches show flat with folder paths; clearing restores the tree.
4. Rename a folder and a dashboard (from the list and from the dashboard toolbar); confirm the dashboard URL is unchanged and the breadcrumb updates.
5. Move a dashboard between folders and to root; move a folder into another folder; confirm the picker disables the folder's own subtree.
6. Delete a dashboard from both entry points.
7. Delete a non-empty folder with "Move contents to root", then another with "Delete everything"; confirm counts shown and resulting state.
8. Unit tests for `buildTree` and picker descendant-exclusion pass.
