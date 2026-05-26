# Dashboard Persistence Design

## Goal

Persist dashboards to the Postgres database as Perses-compliant JSON blobs, validated via Zod. Replace the current in-memory mock data with real CRUD operations.

## Decisions

- **Save model:** Explicit save. User clicks Save on the dashboard grid to persist. Panel edit Apply only updates the zustand store.
- **Seeding:** No seeding. New orgs start with no dashboards.
- **Mock data:** Removed entirely. DB is the single source of truth.
- **Scope:** Single-dashboard CRUD + folder schema. No list/index page UI. No folder management UI.
- **Perses `metadata.project`:** Dropped from `DashboardMetadata`. Multi-tenancy is handled by `organizationId`.

## Database Schema

### `dashboard_folders` table

| Column           | Type                        | Constraints                                     |
|------------------|-----------------------------|------------------------------------------------|
| `id`             | UUID                        | PK, auto-generated                              |
| `organization_id`| text                        | NOT NULL                                        |
| `parent_id`      | UUID                        | Nullable, FK to `dashboard_folders.id` CASCADE  |
| `name`           | text                        | NOT NULL                                        |
| `created_at`     | timestamp with timezone     | NOT NULL, default now()                         |
| `updated_at`     | timestamp with timezone     | NOT NULL, default now()                         |

**Indexes:**
- Unique on `(organization_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'), name)` — no duplicate folder names at the same level. COALESCE handles NULL parent_id since Postgres treats NULLs as distinct in unique indexes.

### `dashboards` table

| Column           | Type                        | Constraints                                     |
|------------------|-----------------------------|------------------------------------------------|
| `id`             | UUID                        | PK, auto-generated                              |
| `organization_id`| text                        | NOT NULL                                        |
| `folder_id`      | UUID                        | Nullable, FK to `dashboard_folders.id` CASCADE  |
| `slug`           | text                        | NOT NULL                                        |
| `spec`           | jsonb                       | NOT NULL, typed as `DashboardSpec`              |
| `created_at`     | timestamp with timezone     | NOT NULL, default now()                         |
| `updated_at`     | timestamp with timezone     | NOT NULL, default now()                         |

**Indexes:**
- Unique on `(organization_id, slug)` — slugs are globally unique within an org
- Index on `(organization_id, updated_at DESC)` — for future list queries

### Folder deletion behavior

Both FKs use CASCADE DELETE at the DB level. Two user-facing modes:

1. **Delete all:** `DELETE FROM dashboard_folders WHERE id = ?` — cascades remove sub-folders and dashboards.
2. **Move to root:** In a transaction, UPDATE dashboards to set `folder_id = NULL`, UPDATE sub-folders to set `parent_id = NULL`, then DELETE the folder.

## Zod Validation

A `dashboardSpecSchema` in `packages/app/src/data/dashboards/schema.ts` mirrors the `DashboardSpec` TypeScript type. Used to validate the JSONB blob on every write.

The recursive `PluginSpecValue` type uses `z.lazy()` for self-referencing union types.

Server function input schemas:
- `saveDashboardInput` — `{ slug: string, spec: DashboardSpec, folderId?: string }`
- `deleteDashboardInput` — `{ slug: string }`
- `createFolderInput` — `{ name: string, parentId?: string }`
- `renameFolderInput` — `{ folderId: string, name: string }`
- `deleteFolderInput` — `{ folderId: string, mode: "cascade" | "move-to-root" }`

DB row spec is parsed through `dashboardSpecSchema.parse(row.spec)` to validate on read — no manual `toDashboard` mapping function.

## Server Functions

All in `packages/app/src/data/dashboards/server.ts`, using `createAuthenticatedServerFn` with `requireOrgMiddleware`.

### Dashboard CRUD

- **`getDashboard({ slug })`** — SELECT by org + slug. Throws if not found.
- **`saveDashboard({ slug, spec, folderId? })`** — Upsert: if slug exists for this org, UPDATE `spec` + `updated_at`; otherwise INSERT. Validates spec via Zod before writing. Returns the slug.
- **`deleteDashboard({ slug })`** — DELETE by org + slug.

### Folder CRUD

- **`listFolders()`** — Returns all folders for the org as a flat list. Client builds the tree from `parentId` references.
- **`createFolder({ name, parentId? })`** — INSERT, returns the new folder id.
- **`renameFolder({ folderId, name })`** — UPDATE name.
- **`deleteFolder({ folderId, mode })`** — If `"cascade"`, DELETE (DB cascades handle children). If `"move-to-root"`, UPDATE children then DELETE, all in a transaction.

### Unchanged

- **`runPanelQuery`** — Still queries ClickHouse. No changes.

### Removed

- **`mock.ts`** — Deleted entirely.

## Type Changes

### `DashboardMetadata`

Drop the `project` field:

```typescript
// Before
interface DashboardMetadata {
  name: string;
  project: string;
}

// After
interface DashboardMetadata {
  name: string;
}
```

All references to `metadata.project` are removed.

## UI Wiring

### Dashboard grid (`dashboard-grid.tsx`)

- Save button calls a `useSaveDashboard` mutation wrapping `saveDashboard({ slug, spec })` with the current store state.
- On success: invalidate `["dashboards", slug]` query cache, show success toast.
- On error: show error toast.

### Panel edit page (`panel-edit-page.tsx`)

- Apply still only updates the zustand store. No DB call.
- No change to Discard behavior.

### Dashboard route (`dashboards.$dashboardId.tsx`)

- `getDashboard` now hits the DB.
- If dashboard not found (throws), show a not-found state instead of crashing.

### Query options (`options.ts`)

- `dashboardOptions` unchanged in shape — calls the updated `getDashboard`.
- Add mutation helpers: `useSaveDashboard`, `useDeleteDashboard`, and folder mutations. Each invalidates relevant query keys on success.

## Out of Scope

- Dashboard list/index page UI
- Folder management UI (tree sidebar, create/rename/delete dialogs)
- Dashboard versioning/history
- Dashboard duplication
- Dashboard sharing/permissions
