# Friendly Names for Known Attributes — Design

**Date:** 2026-06-01
**Status:** Approved, ready for implementation plan
**Area:** `packages/telemetry-explorer/src/logs/ui` (dynamic attribute filter UI)
**Builds on:** `2026-06-01-dynamic-log-attribute-filters-design.md`

## Problem

The dynamic attribute filter UI shows raw OTel attribute keys (e.g. `vcs.repository.name`,
`deployment.environment`) in the "Add filter" key picker and in the active filter row header.
These are accurate but not friendly. For well-known attributes we want to show a human label
(e.g. "Repository") as the primary text, with the raw key kept visible as subtext so users
still know exactly which attribute they're filtering on.

## Scope

- A **curated** dictionary mapping known attribute keys → friendly labels. Unknown keys fall
  back to showing the raw key alone (no subtext, today's look).
- Applied in **both** places: the key picker list and the active filter row header.
- Friendly name is the primary line; raw key is a smaller muted monospace subtext beneath it.

### Non-goals

- No algorithmic name derivation — only the curated map (predictable, no awkward guesses).
- No per-source disambiguation — the dictionary is keyed by attribute key only (keys are
  effectively unique across maps for the curated set).
- No change to filtering/query behavior — purely presentational.

## Design

### Dictionary + lookup (`attribute-meta.ts`)

```ts
// Friendly display names for well-known attribute keys, keyed by the raw key.
// Easy to extend; unknown keys fall back to the raw key in the UI.
export const KNOWN_ATTRIBUTE_LABELS: Record<string, string> = {
  "service.name": "Service",
  "service.namespace": "Namespace",
  "service.version": "Version",
  "service.instance.id": "Instance",
  "deployment.environment": "Environment",
  "deployment.environment.name": "Environment",
  "host.name": "Host",
  "host.arch": "Host arch",
  "os.type": "OS",
  "process.runtime.name": "Runtime",
  "telemetry.sdk.name": "SDK",
  "telemetry.sdk.language": "SDK language",
  "vcs.repository.name": "Repository",
  "vcs.ref.head.name": "Branch",
  "k8s.pod.name": "Pod",
  "k8s.namespace.name": "K8s namespace",
  "k8s.node.name": "Node",
  "container.name": "Container",
};

export function attributeLabel(key: string): string | undefined {
  return KNOWN_ATTRIBUTE_LABELS[key];
}
```

`PROMOTED_ATTRIBUTES` labels are **derived from** `KNOWN_ATTRIBUTE_LABELS` so the promoted
chips, picker, and rows cannot drift:

```ts
export const PROMOTED_ATTRIBUTES: PromotedAttribute[] = (
  [
    { source: "resource", key: "vcs.repository.name" },
    { source: "resource", key: "deployment.environment" },
    { source: "resource", key: "host.name" },
  ] as const
).map((p) => ({ ...p, label: KNOWN_ATTRIBUTE_LABELS[p.key] ?? p.key }));
```

### Key picker list (`attribute-key-picker.tsx`)

For each `CommandItem`, look up `attributeLabel(item.key)`:
- **Known:** render the friendly label as the primary line and the raw key as a smaller muted
  monospace subtext beneath it.
- **Unknown:** render the raw key alone in monospace (current look).

The `CommandItem` `value` (used for search filtering) includes the friendly label, the raw key,
and the source — so typing either "Repository" or "vcs.repository.name" matches.

```tsx
const label = attributeLabel(item.key);
<CommandItem
  key={`${item.source}:${item.key}`}
  value={`${group.source} ${label ?? ""} ${item.key}`}
  onSelect={() => { onSelect({ source: item.source, key: item.key }); setOpen(false); }}
>
  {label ? (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{label}</span>
      <span className="text-muted-foreground truncate font-mono text-[10px]">{item.key}</span>
    </span>
  ) : (
    <span className="truncate font-mono">{item.key}</span>
  )}
</CommandItem>
```

### Active filter row header (`attribute-filter-row.tsx`)

Mirror the same treatment in the row header (currently a single mono `{filter.key}` span):

```tsx
const label = attributeLabel(filter.key);
// ...inside the header flex row, replacing the current key <span>:
{label ? (
  <span className="flex min-w-0 flex-col" title={filter.key}>
    <span className="truncate text-xs font-medium">{label}</span>
    <span className="text-muted-foreground truncate font-mono text-[10px]">{filter.key}</span>
  </span>
) : (
  <span className="truncate font-mono text-xs" title={filter.key}>{filter.key}</span>
)}
```

The remove button's `aria-label` keeps using `filter.key` (stable, unambiguous).

## Testing

- **`attribute-meta.test.ts`** (extend): `attributeLabel` returns the label for a known key and
  `undefined` for an unknown key; `PROMOTED_ATTRIBUTES` labels equal the dictionary values
  (Repository / Environment / Host).
- **`attribute-filter-row.test.tsx`** (extend the existing jsdom render test): for a known key
  the header renders both the friendly label and the raw key; for an unknown key it renders
  only the raw key (no friendly label).
- **`attribute-key-picker.test.tsx`** (new jsdom render test): mock `repo.attributeKeys` to
  return one known and one unknown key, wrap in `QueryClientProvider`, open the popover, and
  assert the known item shows label + key subtext while the unknown shows the key only.
  (Render the component live rather than only typecheck — two earlier UI issues slipped past
  static checks.)
