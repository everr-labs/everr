# Unified Telemetry Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Streamline the Logs / Errors / Traces filter sidebars into one consistent system (shared container, canonical control order, clear-all on every page, free-text search in a header bar) and promote `deployment.environment` to a dedicated top-level control on all three pages.

**Architecture:** Three new shared components in `packages/telemetry-explorer/src/filters/ui/` — `FilterSidebar` (container + header + clear-all), `FilterSearchBar` (header free-text row), and `AttributeValueCombobox` (a `FilterCombobox` bound to a single attribute "in" entry) — plus a `dedicated-attributes.ts` helper. The Environment control is pure UI sugar over the existing `attributes` array (no schema/query/SQL changes): it reads/writes a single `{source:"resource", key:"deployment.environment", op:"in", values}` entry, and that entry is split out of what the generic attribute section renders. Each of the three filter bars is refactored to compose these shared pieces.

**Tech Stack:** React, TypeScript, TanStack Query, Tailwind, shadcn-style `@everr/ui` components, Vitest + `@testing-library/react`.

---

## Background / invariants (read before starting)

- All new shared files live in `packages/telemetry-explorer/src/filters/ui/`. From a filter bar at `…/logs/ui/log-filters.tsx`, the import path is `../../filters/ui/<file>`.
- `AttributeFilter` shape (from `attribute-filter/schemas.ts`): `{ source: AttributeSource; key: string; op: "in"|"not_in"|"exists"|"missing"; values: string[] }`.
- `FilterCombobox` (`@everr/ui/components/filter-combobox`) props: `{ label, values: string[], onChange: (string[])=>void, options: { queryKey, queryFn, select: (data)=>string[] }, placeholder, searchPlaceholder?, className? }`. It only fetches `options` when its popover is open.
- `attributeValuesOptions(repo, { timeRange, source, key, search? }, { domain })` (from `attribute-filter/options.ts`) returns `{ queryKey, queryFn }` where `queryFn` resolves `string[]`. It has **no** `select`, so callers add one.
- `AttributeFilterSection` renders **all** of its `attributes` prop as pills and uses `excludedKeys` only to hide keys from the *add* menu. Therefore the Environment entry must be removed from the `attributes` passed to it (via `splitDedicatedAttributes`) **and** its key added to `excludedKeys`.
- `attributeLabel("deployment.environment")` already returns `"Environment"` — no metadata change needed.
- Cross-package safety: `@everr/desktop-app` imports only the explorer wrappers (`LogsExplorer`, `ErrorIssues`, `TracesSearch`), never the filter-bar components (verified). Still run its tsc at the end because it has no `typecheck` script.
- Test harness pattern (copy this helper into each new `.test.tsx`):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}
```

- Run a single test file with: `pnpm --filter @everr/telemetry-explorer exec vitest run <path>`.

---

## Task 1: `FilterSidebar` shared container

**Files:**
- Create: `packages/telemetry-explorer/src/filters/ui/filter-sidebar.tsx`
- Test: `packages/telemetry-explorer/src/filters/ui/filter-sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/telemetry-explorer/src/filters/ui/filter-sidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterSidebar } from "./filter-sidebar";

describe("FilterSidebar", () => {
  it("renders the Filter header and children", () => {
    render(
      <FilterSidebar label="Log filters" hasActiveFilters={false} onClear={vi.fn()}>
        <div>child content</div>
      </FilterSidebar>,
    );
    expect(screen.getByRole("complementary", { name: "Log filters" })).toBeInTheDocument();
    expect(screen.getByText("Filter")).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("shows Clear all only when filters are active and calls onClear", async () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <FilterSidebar label="Log filters" hasActiveFilters={false} onClear={onClear}>
        <div />
      </FilterSidebar>,
    );
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();

    rerender(
      <FilterSidebar label="Log filters" hasActiveFilters onClear={onClear}>
        <div />
      </FilterSidebar>,
    );
    screen.getByRole("button", { name: "Clear all" }).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/filters/ui/filter-sidebar.test.tsx`
Expected: FAIL — cannot resolve `./filter-sidebar`.

- [ ] **Step 3: Write the implementation**

`packages/telemetry-explorer/src/filters/ui/filter-sidebar.tsx`:

```tsx
import { ListFilter } from "lucide-react";
import type { ReactNode } from "react";

export function FilterSidebar({
  label,
  hasActiveFilters,
  onClear,
  children,
}: {
  label: string;
  hasActiveFilters: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="bg-muted/15 flex h-full min-h-0 flex-col gap-3 overflow-auto border-b p-3 lg:border-r lg:border-b-0"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <ListFilter className="text-muted-foreground size-3.5" />
          Filter
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs underline"
            onClick={onClear}
          >
            Clear all
          </button>
        )}
      </div>
      {children}
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/filters/ui/filter-sidebar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/filters/ui/filter-sidebar.tsx packages/telemetry-explorer/src/filters/ui/filter-sidebar.test.tsx
git commit -m "Add shared FilterSidebar container"
```

---

## Task 2: `FilterSearchBar` shared header search

**Files:**
- Create: `packages/telemetry-explorer/src/filters/ui/filter-search-bar.tsx`
- Test: `packages/telemetry-explorer/src/filters/ui/filter-search-bar.test.tsx`

This generalizes the existing `ErrorSearchForm`: a controlled draft, submit-to-commit, a clear "X" shown only when there is a committed value, and a Search button.

- [ ] **Step 1: Write the failing test**

`packages/telemetry-explorer/src/filters/ui/filter-search-bar.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterSearchBar } from "./filter-search-bar";

describe("FilterSearchBar", () => {
  it("commits the trimmed draft on submit", () => {
    const onChange = vi.fn();
    render(
      <FilterSearchBar
        id="logs-search"
        label="Search logs"
        value=""
        onChange={onChange}
        placeholder="Search messages"
      />,
    );
    const input = screen.getByLabelText("Search logs");
    fireEvent.change(input, { target: { value: "  boom  " } });
    fireEvent.submit(input);
    expect(onChange).toHaveBeenCalledWith("boom");
  });

  it("shows a clear button only when a value is committed and clears it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterSearchBar id="s" label="Search" value="" onChange={onChange} placeholder="p" />,
    );
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    rerender(
      <FilterSearchBar id="s" label="Search" value="boom" onChange={onChange} placeholder="p" />,
    );
    screen.getByRole("button", { name: "Clear search" }).click();
    expect(onChange).toHaveBeenCalledWith("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/filters/ui/filter-search-bar.test.tsx`
Expected: FAIL — cannot resolve `./filter-search-bar`.

- [ ] **Step 3: Write the implementation**

`packages/telemetry-explorer/src/filters/ui/filter-search-bar.tsx`:

```tsx
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

export function FilterSearchBar({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        onChange(draft.trim());
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <InputGroup className="h-8">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="search"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={placeholder}
        />
        <InputGroupAddon align="inline-end">
          {value ? (
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => {
                setDraft("");
                onChange("");
              }}
            >
              <X />
            </InputGroupButton>
          ) : null}
          <InputGroupButton type="submit" variant="secondary">
            Search
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/filters/ui/filter-search-bar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/filters/ui/filter-search-bar.tsx packages/telemetry-explorer/src/filters/ui/filter-search-bar.test.tsx
git commit -m "Add shared FilterSearchBar header search"
```

---

## Task 3: `dedicated-attributes` helper

**Files:**
- Create: `packages/telemetry-explorer/src/filters/ui/dedicated-attributes.ts`
- Test: `packages/telemetry-explorer/src/filters/ui/dedicated-attributes.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/telemetry-explorer/src/filters/ui/dedicated-attributes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import {
  ENVIRONMENT_ATTRIBUTE,
  splitDedicatedAttributes,
} from "./dedicated-attributes";

const env = (op: AttributeFilter["op"], values: string[] = []): AttributeFilter => ({
  source: "resource",
  key: "deployment.environment",
  op,
  values,
});

describe("splitDedicatedAttributes", () => {
  it("separates the dedicated 'in' entry from the rest", () => {
    const other: AttributeFilter = { source: "log", key: "code", op: "in", values: ["x"] };
    const { dedicated, rest } = splitDedicatedAttributes(
      [env("in", ["prod"]), other],
      [ENVIRONMENT_ATTRIBUTE],
    );
    expect(dedicated).toEqual([env("in", ["prod"])]);
    expect(rest).toEqual([other]);
  });

  it("leaves a non-'in' entry for a dedicated key in rest", () => {
    const { dedicated, rest } = splitDedicatedAttributes(
      [env("not_in", ["dev"])],
      [ENVIRONMENT_ATTRIBUTE],
    );
    expect(dedicated).toEqual([]);
    expect(rest).toEqual([env("not_in", ["dev"])]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/filters/ui/dedicated-attributes.test.ts`
Expected: FAIL — cannot resolve `./dedicated-attributes`.

- [ ] **Step 3: Write the implementation**

`packages/telemetry-explorer/src/filters/ui/dedicated-attributes.ts`:

```ts
import type { AttributeFilter } from "../../attribute-filter/schemas";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";

// Attributes promoted to dedicated top-level controls. Their "in" entry is owned
// by a dedicated combobox (e.g. the Environment filter), so it must be hidden
// from the generic attribute pills and the picker's add menu.
export const ENVIRONMENT_ATTRIBUTE: PromotedAttribute = {
  source: "resource",
  key: "deployment.environment",
};

function isDedicated(
  filter: AttributeFilter,
  dedicated: readonly PromotedAttribute[],
): boolean {
  return dedicated.some(
    (d) => d.source === filter.source && d.key === filter.key && filter.op === "in",
  );
}

// Partition `attributes` into the dedicated-control entries (e.g. the Environment
// "in" filter) and the rest, which feed the generic attribute section. A legacy
// non-"in" entry for a dedicated key stays in `rest` so it is still shown and
// applied.
export function splitDedicatedAttributes(
  attributes: AttributeFilter[],
  dedicated: readonly PromotedAttribute[],
): { dedicated: AttributeFilter[]; rest: AttributeFilter[] } {
  const ded: AttributeFilter[] = [];
  const rest: AttributeFilter[] = [];
  for (const filter of attributes) {
    if (isDedicated(filter, dedicated)) ded.push(filter);
    else rest.push(filter);
  }
  return { dedicated: ded, rest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/filters/ui/dedicated-attributes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/filters/ui/dedicated-attributes.ts packages/telemetry-explorer/src/filters/ui/dedicated-attributes.test.ts
git commit -m "Add dedicated-attributes split helper"
```

---

## Task 4: `AttributeValueCombobox`

**Files:**
- Create: `packages/telemetry-explorer/src/filters/ui/attribute-value-combobox.tsx`
- Test: `packages/telemetry-explorer/src/filters/ui/attribute-value-combobox.test.tsx`

A `FilterCombobox` bound to a single `{source,key,op:"in"}` entry inside the shared `attributes` array. Reads that entry's values; on change rewrites the array with only that entry replaced (removing it when no values remain), preserving all other attributes.

- [ ] **Step 1: Write the failing test**

`packages/telemetry-explorer/src/filters/ui/attribute-value-combobox.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import { AttributeValueCombobox } from "./attribute-value-combobox";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

const repo = {
  attributeKeys: vi.fn().mockResolvedValue([]),
  attributeValues: vi.fn().mockResolvedValue([]),
} as unknown as AttributeRepositoryLike;

function setup(attributes: AttributeFilter[], onChange = vi.fn()) {
  renderWithQueryClient(
    <AttributeValueCombobox
      repo={repo}
      domain="logs"
      timeRange={{ from: "now-1h", to: "now" }}
      source="resource"
      attributeKey="deployment.environment"
      label="Environment"
      placeholder="All environments"
      attributes={attributes}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("AttributeValueCombobox", () => {
  it("renders its label", () => {
    setup([]);
    expect(screen.getByText("Environment")).toBeInTheDocument();
  });

  it("shows the selected count badge from the matching 'in' entry", () => {
    setup([
      { source: "resource", key: "deployment.environment", op: "in", values: ["prod", "staging"] },
    ]);
    // FilterCombobox shows the first value plus a "+N" badge for the rest.
    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/filters/ui/attribute-value-combobox.test.tsx`
Expected: FAIL — cannot resolve `./attribute-value-combobox`.

- [ ] **Step 3: Write the implementation**

`packages/telemetry-explorer/src/filters/ui/attribute-value-combobox.tsx`:

```tsx
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { attributeValuesOptions } from "../../attribute-filter/options";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import type { AttributeFilter, AttributeSource } from "../../attribute-filter/schemas";

export function AttributeValueCombobox({
  repo,
  domain,
  timeRange,
  source,
  attributeKey,
  label,
  placeholder,
  searchPlaceholder,
  attributes,
  onChange,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  source: AttributeSource;
  attributeKey: string;
  label: string;
  placeholder: string;
  searchPlaceholder?: string;
  attributes: AttributeFilter[];
  onChange: (next: AttributeFilter[]) => void;
}) {
  const matches = (filter: AttributeFilter) =>
    filter.source === source && filter.key === attributeKey && filter.op === "in";

  const current = attributes.find(matches);
  const values = current?.values ?? [];

  const setValues = (next: string[]) => {
    const others = attributes.filter((filter) => !matches(filter));
    onChange(
      next.length === 0
        ? others
        : [...others, { source, key: attributeKey, op: "in", values: next }],
    );
  };

  const options = {
    ...attributeValuesOptions(
      repo,
      { timeRange, source, key: attributeKey },
      { domain },
    ),
    select: (data: string[]) => data,
  };

  return (
    <FilterCombobox
      label={label}
      values={values}
      onChange={setValues}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      className="w-full"
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/filters/ui/attribute-value-combobox.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/filters/ui/attribute-value-combobox.tsx packages/telemetry-explorer/src/filters/ui/attribute-value-combobox.test.tsx
git commit -m "Add AttributeValueCombobox for dedicated attribute filters"
```

---

## Task 5: Update per-domain attribute configs for Environment promotion

Environment moves from the picker's "Suggested" list to a dedicated control, so: remove it from each `*_PROMOTED_ATTRIBUTES`, and add its key to each `*_EXCLUDED_KEYS` (so the picker's add menu no longer offers it).

**Files:**
- Modify: `packages/telemetry-explorer/src/logs/ui/log-attribute-config.ts`
- Modify: `packages/telemetry-explorer/src/errors/ui/error-attribute-config.ts`
- Modify: `packages/telemetry-explorer/src/traces/ui/trace-attribute-config.ts`

- [ ] **Step 1: Edit logs config**

In `log-attribute-config.ts`, change `LOGS_PROMOTED_ATTRIBUTES` to drop the environment entry:

```ts
export const LOGS_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name" },
  { source: "resource", key: "host.name" },
];
```

And change `LOGS_EXCLUDED_KEYS`:

```ts
// service.name backs the dedicated Service filter; deployment.environment backs
// the dedicated Environment filter — both redundant as chips.
export const LOGS_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:deployment.environment",
]);
```

- [ ] **Step 2: Edit errors config**

In `error-attribute-config.ts`, change `ERRORS_PROMOTED_ATTRIBUTES`:

```ts
export const ERRORS_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name" },
  { source: "resource", key: "host.name" },
];
```

And change `ERRORS_EXCLUDED_KEYS`:

```ts
// service.name backs the Service filter; deployment.environment backs the
// dedicated Environment filter.
export const ERRORS_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:deployment.environment",
]);
```

- [ ] **Step 3: Edit traces config**

In `trace-attribute-config.ts`, change `TRACES_PROMOTED_ATTRIBUTES` to drop environment:

```ts
export const TRACES_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "span", key: "http.route" },
  { source: "span", key: "db.system" },
];
```

And change `TRACES_EXCLUDED_KEYS`:

```ts
// service.name backs the Service filter; service.namespace backs the Namespace
// filter; deployment.environment backs the dedicated Environment filter.
export const TRACES_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:service.namespace",
  "resource:deployment.environment",
]);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-explorer/src/logs/ui/log-attribute-config.ts packages/telemetry-explorer/src/errors/ui/error-attribute-config.ts packages/telemetry-explorer/src/traces/ui/trace-attribute-config.ts
git commit -m "Promote environment out of suggested attributes"
```

---

## Task 6: Refactor Logs filter bar + explorer

Adopt `FilterSidebar`, add the Environment control, reorder to canonical (Level → Service → Environment → Trace → Attributes), wire clear-all, and move the explorer's free-text search to `FilterSearchBar`. Remove the now-redundant `<aside>` wrapper in the explorer.

**Files:**
- Modify: `packages/telemetry-explorer/src/logs/ui/log-filters.tsx`
- Modify: `packages/telemetry-explorer/src/logs/ui/logs-explorer.tsx`
- Test: `packages/telemetry-explorer/src/logs/ui/log-filters.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

`packages/telemetry-explorer/src/logs/ui/log-filters.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LogsRepositoryLike } from "../data/repository";
import { LogFiltersBar } from "./log-filters";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

const repo = {
  attributeKeys: vi.fn().mockResolvedValue([]),
  attributeValues: vi.fn().mockResolvedValue([]),
  filterOptions: vi.fn().mockResolvedValue({ services: [] }),
} as unknown as LogsRepositoryLike;

const baseProps = {
  repo,
  timeRange: { from: "now-1h", to: "now" } as const,
  levels: [],
  services: [],
  attributes: [],
  traceId: undefined,
};

describe("LogFiltersBar", () => {
  it("renders Service, Environment and the attribute section inside the sidebar", () => {
    renderWithQueryClient(<LogFiltersBar {...baseProps} onChange={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "Log filters" })).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });

  it("clear-all resets levels, services, attributes and trace id", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <LogFiltersBar
        {...baseProps}
        levels={["error"]}
        services={["api"]}
        traceId="abc"
        onChange={onChange}
      />,
    );
    screen.getByRole("button", { name: "Clear all" }).click();
    expect(onChange).toHaveBeenCalledWith({
      levels: [],
      services: [],
      attributes: [],
      traceId: undefined,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/ui/log-filters.test.tsx`
Expected: FAIL — "Environment" not found and no `complementary` role (current `LogFiltersBar` renders a bare `div`).

- [ ] **Step 3: Rewrite `log-filters.tsx`**

Replace the entire file with:

```tsx
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Separator } from "@everr/ui/components/separator";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { Hash, X } from "lucide-react";
import { useState } from "react";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import { AttributeValueCombobox } from "../../filters/ui/attribute-value-combobox";
import {
  ENVIRONMENT_ATTRIBUTE,
  splitDedicatedAttributes,
} from "../../filters/ui/dedicated-attributes";
import { FilterSidebar } from "../../filters/ui/filter-sidebar";
import { logServiceFilterOptions } from "../data/options";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter, LogLevel } from "../schemas";
import {
  LOGS_ATTRIBUTE_SOURCES_UI,
  LOGS_EXCLUDED_KEYS,
  LOGS_PROMOTED_ATTRIBUTES,
} from "./log-attribute-config";
import { LOG_LEVEL_META, LOG_LEVELS } from "./log-level-meta";

export interface LogFiltersBarProps {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  levels: LogLevel[];
  services: string[];
  attributes: AttributeFilter[];
  traceId: string | undefined;
  levelCounts?: Record<LogLevel, number>;
  onChange: (patch: {
    levels?: LogLevel[];
    services?: string[];
    attributes?: AttributeFilter[];
    traceId?: string;
  }) => void;
}

function levelDotClassName(level: LogLevel) {
  return LOG_LEVEL_META[level].dotClassName;
}

function TraceFilter({
  traceId,
  onChange,
}: {
  traceId?: string;
  onChange: (traceId?: string) => void;
}) {
  const [value, setValue] = useState(traceId ?? "");

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        onChange(trimmed || undefined);
      }}
    >
      <label htmlFor="logs-trace-id" className="text-muted-foreground text-xs">
        Trace
      </label>
      <InputGroup className="h-8">
        <InputGroupAddon>
          <Hash />
        </InputGroupAddon>
        <InputGroupInput
          id="logs-trace-id"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Any trace"
        />
        {traceId ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear trace"
              onClick={() => {
                setValue("");
                onChange(undefined);
              }}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </form>
  );
}

export function LogFiltersBar({
  repo,
  timeRange,
  levels,
  services,
  attributes,
  traceId,
  levelCounts,
  onChange,
}: LogFiltersBarProps) {
  const toggleLevel = (level: LogLevel) => {
    const nextLevels = levels.includes(level)
      ? levels.filter((item) => item !== level)
      : [...levels, level];
    onChange({ levels: nextLevels });
  };

  const { dedicated: dedicatedAttributes, rest: pickerAttributes } =
    splitDedicatedAttributes(attributes, [ENVIRONMENT_ATTRIBUTE]);

  const hasActiveFilters =
    levels.length > 0 ||
    services.length > 0 ||
    attributes.length > 0 ||
    traceId !== undefined;

  return (
    <FilterSidebar
      label="Log filters"
      hasActiveFilters={hasActiveFilters}
      onClear={() =>
        onChange({
          levels: [],
          services: [],
          attributes: [],
          traceId: undefined,
        })
      }
    >
      <div className="space-y-1">
        {LOG_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={cn(
              "flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-xs transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              levels.includes(level) &&
                "bg-background font-medium shadow-xs ring-1 ring-border",
            )}
            onClick={() => toggleLevel(level)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn("size-2 rounded-full", levelDotClassName(level))}
              />
              <span className="truncate capitalize">{level}</span>
            </span>
            <span className="text-muted-foreground font-mono tabular-nums">
              {levelCounts ? levelCounts[level].toLocaleString() : "—"}
            </span>
          </button>
        ))}
      </div>

      <Separator />

      <FilterCombobox
        label="Service"
        values={services}
        onChange={(nextServices) => onChange({ services: nextServices })}
        options={logServiceFilterOptions(repo, { timeRange })}
        placeholder="All services"
        searchPlaceholder="Search services..."
        className="w-full"
      />

      <AttributeValueCombobox
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        source={ENVIRONMENT_ATTRIBUTE.source}
        attributeKey={ENVIRONMENT_ATTRIBUTE.key}
        label="Environment"
        placeholder="All environments"
        searchPlaceholder="Search environments..."
        attributes={attributes}
        onChange={(next) => onChange({ attributes: next })}
      />

      <Separator />

      <TraceFilter
        traceId={traceId}
        onChange={(nextTraceId) => onChange({ traceId: nextTraceId })}
      />

      <Separator />

      <AttributeFilterSection
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        attributes={pickerAttributes}
        promotedAttributes={LOGS_PROMOTED_ATTRIBUTES}
        excludedKeys={LOGS_EXCLUDED_KEYS}
        sources={LOGS_ATTRIBUTE_SOURCES_UI}
        onChange={(next) =>
          onChange({ attributes: [...dedicatedAttributes, ...next] })
        }
      />
    </FilterSidebar>
  );
}
```

- [ ] **Step 4: Update `logs-explorer.tsx` — header search + remove aside wrapper**

In `logs-explorer.tsx`:

a) Update the imports at the top of the file. Remove the InputGroup import block (lines 1-6) and remove `Search, X` from the lucide import (line 16, which becomes fully unused — delete that line). Add the `FilterSearchBar` import alongside the other `./` imports (e.g. after the `LogFiltersBar` import on line 27):

```tsx
import { FilterSearchBar } from "../../filters/ui/filter-search-bar";
```

b) Replace the entire search `<form>…</form>` currently inside `<div className="border-b bg-muted/10 px-3 py-2">` (lines ~280-318) with:

```tsx
          <FilterSearchBar
            id="logs-search"
            label="Search logs"
            value={filters.q ?? ""}
            onChange={(q) => applyFilters({ q: q || undefined })}
            placeholder="Search messages, errors, IDs"
          />
```

so the block reads:

```tsx
        <div className="border-b bg-muted/10 px-3 py-2">
          <FilterSearchBar
            id="logs-search"
            label="Search logs"
            value={filters.q ?? ""}
            onChange={(q) => applyFilters({ q: q || undefined })}
            placeholder="Search messages, errors, IDs"
          />
        </div>
```

c) Replace the `<aside>` wrapper around `LogFiltersBar` (lines ~328-339) with the bare component, since `FilterSidebar` now renders the `<aside>`:

```tsx
          <LogFiltersBar
            repo={repo}
            timeRange={timeRange}
            levels={filters.levels}
            services={filters.services}
            attributes={filters.attributes}
            traceId={filters.traceId}
            levelCounts={levelCounts}
            onChange={(patch) => applyFilters(patch)}
          />
```

(Delete the opening `<aside className="bg-muted/15 min-h-0 border-b lg:border-r lg:border-b-0">` and its matching `</aside>`.)

- [ ] **Step 5: Run the log-filters test + typecheck**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/logs/ui/log-filters.test.tsx`
Expected: PASS (2 tests).

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS — confirms no unused imports remain in `logs-explorer.tsx`.

- [ ] **Step 6: Commit**

```bash
git add packages/telemetry-explorer/src/logs/ui/log-filters.tsx packages/telemetry-explorer/src/logs/ui/log-filters.test.tsx packages/telemetry-explorer/src/logs/ui/logs-explorer.tsx
git commit -m "Unify logs filter bar with shared sidebar and Environment filter"
```

---

## Task 7: Refactor Errors filter bar + issues view

Adopt `FilterSidebar`, add Environment, reorder to canonical (Order → Service → Environment → Attributes), wire clear-all (excluding the sort), and replace `ErrorSearchForm` with the shared `FilterSearchBar`.

**Files:**
- Modify: `packages/telemetry-explorer/src/errors/ui/error-filters.tsx`
- Modify: `packages/telemetry-explorer/src/errors/ui/error-issues.tsx`
- Modify: `packages/telemetry-explorer/src/errors/ui/error-filters.test.tsx`

- [ ] **Step 1: Extend the failing test**

Replace the body of `error-filters.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ErrorsRepositoryLike } from "../data/repository";
import { ErrorFilters } from "./error-filters";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

const repo = {
  attributeKeys: vi.fn().mockResolvedValue([]),
  attributeValues: vi.fn().mockResolvedValue([]),
} as unknown as ErrorsRepositoryLike;

const baseValue = {
  q: "",
  service: [] as string[],
  fingerprint: "",
  sort: "lastSeen" as const,
  attributes: [],
};

describe("ErrorFilters", () => {
  it("renders Service, Environment and the attribute section in the sidebar", () => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={baseValue}
        services={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Error filters" })).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });

  it("clear-all resets service and attributes but not the sort order", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={{ ...baseValue, service: ["api"], sort: "count" }}
        services={["api"]}
        onChange={onChange}
      />,
    );
    screen.getByRole("button", { name: "Clear all" }).click();
    expect(onChange).toHaveBeenCalledWith({ service: [], attributes: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/errors/ui/error-filters.test.tsx`
Expected: FAIL — "Environment" not found / no "Clear all" button.

- [ ] **Step 3: Rewrite `error-filters.tsx`**

Replace the entire file with (note: `ErrorSearchForm` is removed; it is replaced by `FilterSearchBar` in Task 7 Step 4):

```tsx
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { Label } from "@everr/ui/components/label";
import { Separator } from "@everr/ui/components/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useId } from "react";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import { AttributeValueCombobox } from "../../filters/ui/attribute-value-combobox";
import {
  ENVIRONMENT_ATTRIBUTE,
  splitDedicatedAttributes,
} from "../../filters/ui/dedicated-attributes";
import { FilterSidebar } from "../../filters/ui/filter-sidebar";
import type { ErrorsRepositoryLike } from "../data/repository";
import type { AttributeFilter } from "../data/schemas";
import type { ErrorSort } from "../data/types";
import {
  ERRORS_ATTRIBUTE_SOURCES_UI,
  ERRORS_EXCLUDED_KEYS,
  ERRORS_PROMOTED_ATTRIBUTES,
} from "./error-attribute-config";

export type ErrorFiltersValue = {
  q: string;
  service: string[];
  fingerprint: string;
  sort: ErrorSort;
  attributes: AttributeFilter[];
};

export function ErrorFilters({
  repo,
  timeRange,
  value,
  services,
  onChange,
}: {
  repo: ErrorsRepositoryLike;
  timeRange: TimeRange;
  value: ErrorFiltersValue;
  services: string[];
  onChange: (patch: Partial<ErrorFiltersValue>) => void;
}) {
  const orderLabelId = useId();
  const serviceOptions = [
    ...services,
    ...value.service.filter((service) => !services.includes(service)),
  ];
  const serviceFilterOptions = {
    queryKey: ["errors", "service-filter-options", serviceOptions] as const,
    queryFn: async () => serviceOptions,
    select: (data: string[]) => data,
  };

  const { dedicated: dedicatedAttributes, rest: pickerAttributes } =
    splitDedicatedAttributes(value.attributes, [ENVIRONMENT_ATTRIBUTE]);

  const hasActiveFilters =
    value.service.length > 0 || value.attributes.length > 0;

  return (
    <FilterSidebar
      label="Error filters"
      hasActiveFilters={hasActiveFilters}
      onClear={() => onChange({ service: [], attributes: [] })}
    >
      <div className="flex flex-col gap-1">
        <Label id={orderLabelId} className="text-muted-foreground text-xs">
          Order
        </Label>
        <ToggleGroup
          value={[value.sort]}
          size="lg"
          variant="outline"
          spacing={0}
          className="w-full"
          onValueChange={(next) => {
            const selected = next[0];
            if (selected === "lastSeen" || selected === "count") {
              onChange({ sort: selected });
            }
          }}
          aria-labelledby={orderLabelId}
        >
          <ToggleGroupItem
            value="lastSeen"
            aria-label="Last seen"
            className="flex-1"
          >
            Last seen
          </ToggleGroupItem>
          <ToggleGroupItem value="count" aria-label="Count" className="flex-1">
            Count
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Separator />

      <FilterCombobox
        label="Service"
        values={value.service}
        onChange={(nextServices) => onChange({ service: nextServices })}
        options={serviceFilterOptions}
        placeholder="All services"
        searchPlaceholder="Search services..."
        className="w-full"
      />

      <AttributeValueCombobox
        repo={repo}
        domain="errors"
        timeRange={timeRange}
        source={ENVIRONMENT_ATTRIBUTE.source}
        attributeKey={ENVIRONMENT_ATTRIBUTE.key}
        label="Environment"
        placeholder="All environments"
        searchPlaceholder="Search environments..."
        attributes={value.attributes}
        onChange={(attributes) => onChange({ attributes })}
      />

      <Separator />

      <AttributeFilterSection
        repo={repo}
        domain="errors"
        timeRange={timeRange}
        attributes={pickerAttributes}
        promotedAttributes={ERRORS_PROMOTED_ATTRIBUTES}
        excludedKeys={ERRORS_EXCLUDED_KEYS}
        sources={ERRORS_ATTRIBUTE_SOURCES_UI}
        onChange={(attributes) =>
          onChange({ attributes: [...dedicatedAttributes, ...attributes] })
        }
      />
    </FilterSidebar>
  );
}
```

- [ ] **Step 4: Update `error-issues.tsx` — use `FilterSearchBar`**

In `error-issues.tsx`:

a) Change the import on line 16 from:

```tsx
import { ErrorFilters, ErrorSearchForm } from "./error-filters";
```

to:

```tsx
import { ErrorFilters } from "./error-filters";
```

and add:

```tsx
import { FilterSearchBar } from "../../filters/ui/filter-search-bar";
```

b) Replace the `<ErrorSearchForm … />` (lines ~76-79) with:

```tsx
          <FilterSearchBar
            id="errors-search"
            label="Search errors"
            value={search.q}
            onChange={(q) => onSearchChange({ q })}
            placeholder="Search errors"
          />
```

- [ ] **Step 5: Run the errors test + typecheck**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/errors/ui/error-filters.test.tsx src/errors/ui/error-pages.test.tsx`
Expected: PASS.

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS — confirms `ErrorSearchForm` has no remaining references.

- [ ] **Step 6: Commit**

```bash
git add packages/telemetry-explorer/src/errors/ui/error-filters.tsx packages/telemetry-explorer/src/errors/ui/error-filters.test.tsx packages/telemetry-explorer/src/errors/ui/error-issues.tsx
git commit -m "Unify errors filter bar with shared sidebar and Environment filter"
```

---

## Task 8: Refactor Traces filter bar + search page

Adopt `FilterSidebar`, add Environment, reorder to canonical (Status → Namespace → Service → Environment → Min/Max ms → Attributes), move clear-all into the sidebar header, and move the span-name search out of the sidebar into a new header bar (`FilterSearchBar`) — matching Logs/Errors layout.

**Files:**
- Modify: `packages/telemetry-explorer/src/traces/ui/trace-filters.tsx`
- Modify: `packages/telemetry-explorer/src/traces/ui/traces-search-page.tsx`
- Modify: `packages/telemetry-explorer/src/traces/ui/trace-filters.test.tsx`

- [ ] **Step 1: Update the failing test**

Replace the body of `trace-filters.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TracesRepositoryLike } from "../data/repository";
import { TraceFilters } from "./trace-filters";

function makeRepo(): TracesRepositoryLike {
  return {
    attributeKeys: vi.fn().mockResolvedValue([]),
    attributeValues: vi.fn().mockResolvedValue([]),
  } as unknown as TracesRepositoryLike;
}

const defaultTimeRange = { from: "now-1h", to: "now" } as const;

const defaultValue = {
  namespace: [],
  service: [],
  minMs: undefined,
  maxMs: undefined,
  status: "all" as const,
  attributes: [],
};

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe("TraceFilters sidebar", () => {
  it("renders Status, Service, Environment and the attribute section", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Trace filters" })).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });

  it("does not render the span-name input (it moved to the header bar)", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByPlaceholderText("Span name contains...")).not.toBeInTheDocument();
  });

  it("clear-all resets namespace, service, durations, status and attributes", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={{ ...defaultValue, status: "error", service: ["web"] }}
        identities={[]}
        onChange={onChange}
      />,
    );
    screen.getByRole("button", { name: "Clear all" }).click();
    expect(onChange).toHaveBeenCalledWith({
      namespace: [],
      service: [],
      minMs: undefined,
      maxMs: undefined,
      status: "all",
      attributes: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/traces/ui/trace-filters.test.tsx`
Expected: FAIL — `value` type still requires `name`; "Environment" not found.

- [ ] **Step 3: Rewrite `trace-filters.tsx`**

Replace the entire file with (the `NameInput` component is removed; `name` is no longer part of `FilterValue`):

```tsx
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Separator } from "@everr/ui/components/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useId, useRef, useState } from "react";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import { AttributeValueCombobox } from "../../filters/ui/attribute-value-combobox";
import {
  ENVIRONMENT_ATTRIBUTE,
  splitDedicatedAttributes,
} from "../../filters/ui/dedicated-attributes";
import { FilterSidebar } from "../../filters/ui/filter-sidebar";
import type { TracesRepositoryLike } from "../data/repository";
import type { AttributeFilter } from "../data/schemas";
import type { ServiceIdentity } from "../data/types";
import {
  TRACES_ATTRIBUTE_SOURCES_UI,
  TRACES_EXCLUDED_KEYS,
  TRACES_PROMOTED_ATTRIBUTES,
} from "./trace-attribute-config";

type StatusValue = "ok" | "error" | "all";

type FilterValue = {
  namespace: string[];
  service: string[];
  minMs?: number;
  maxMs?: number;
  status: StatusValue;
  attributes: AttributeFilter[];
};

type TraceFiltersProps = {
  repo: TracesRepositoryLike;
  timeRange: TimeRange;
  value: FilterValue;
  identities: ServiceIdentity[];
  onChange: (patch: Partial<FilterValue>) => void;
};

export function TraceFilters({
  repo,
  timeRange,
  value,
  identities,
  onChange,
}: TraceFiltersProps) {
  const namespaces = dedupe(
    identities.map((i) => i.serviceNamespace).filter((n) => n.length > 0),
  );
  const serviceList = dedupe(
    identities
      .filter(
        (i) =>
          value.namespace.length === 0 ||
          value.namespace.includes(i.serviceNamespace),
      )
      .map((i) => i.serviceName),
  );

  const namespaceOptions = staticListOptions(
    ["traces", "filter", "namespaces", namespaces] as const,
    namespaces,
  );
  const serviceOptions = staticListOptions(
    ["traces", "filter", "services", serviceList] as const,
    serviceList,
  );

  const { dedicated: dedicatedAttributes, rest: pickerAttributes } =
    splitDedicatedAttributes(value.attributes, [ENVIRONMENT_ATTRIBUTE]);

  const hasActiveFilters =
    value.namespace.length > 0 ||
    value.service.length > 0 ||
    value.minMs !== undefined ||
    value.maxMs !== undefined ||
    value.status !== "all" ||
    value.attributes.length > 0;

  return (
    <FilterSidebar
      label="Trace filters"
      hasActiveFilters={hasActiveFilters}
      onClear={() =>
        onChange({
          namespace: [],
          service: [],
          minMs: undefined,
          maxMs: undefined,
          status: "all",
          attributes: [],
        })
      }
    >
      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">Status</Label>
        <ToggleGroup
          value={[value.status]}
          variant="outline"
          size="lg"
          spacing={0}
          className="w-full"
          onValueChange={(next) => {
            const selected = next[0];
            if (
              selected === "ok" ||
              selected === "error" ||
              selected === "all"
            ) {
              onChange({ status: selected });
            }
          }}
          aria-label="Status"
        >
          <ToggleGroupItem value="all" className="flex-1">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="ok" className="flex-1">
            Ok
          </ToggleGroupItem>
          <ToggleGroupItem value="error" className="flex-1">
            Error
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Separator />

      <FilterCombobox
        label="Namespace"
        values={value.namespace}
        onChange={(next) => onChange({ namespace: next })}
        options={namespaceOptions}
        placeholder="All"
        searchPlaceholder="Search namespaces..."
        className="w-full"
      />
      <FilterCombobox
        label="Service"
        values={value.service}
        onChange={(next) => onChange({ service: next })}
        options={serviceOptions}
        placeholder="All"
        searchPlaceholder="Search services..."
        className="w-full"
      />

      <AttributeValueCombobox
        repo={repo}
        domain="traces"
        timeRange={timeRange}
        source={ENVIRONMENT_ATTRIBUTE.source}
        attributeKey={ENVIRONMENT_ATTRIBUTE.key}
        label="Environment"
        placeholder="All environments"
        searchPlaceholder="Search environments..."
        attributes={value.attributes}
        onChange={(attributes) => onChange({ attributes })}
      />

      <Separator />

      <div className="flex gap-2">
        <DurationInput
          label="Min ms"
          value={value.minMs}
          onCommit={(minMs) => onChange({ minMs })}
        />
        <DurationInput
          label="Max ms"
          value={value.maxMs}
          onCommit={(maxMs) => onChange({ maxMs })}
        />
      </div>

      <Separator />

      <AttributeFilterSection
        repo={repo}
        domain="traces"
        timeRange={timeRange}
        attributes={pickerAttributes}
        promotedAttributes={TRACES_PROMOTED_ATTRIBUTES}
        excludedKeys={TRACES_EXCLUDED_KEYS}
        sources={TRACES_ATTRIBUTE_SOURCES_UI}
        onChange={(attributes) =>
          onChange({ attributes: [...dedicatedAttributes, ...attributes] })
        }
      />
    </FilterSidebar>
  );
}

function DurationInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  onCommit: (next: number | undefined) => void;
}) {
  const id = useId();
  const asString = (v: number | undefined) =>
    v === undefined ? "" : String(v);
  const [local, setLocal] = useState(asString(value));
  const lastValueRef = useRef(value);
  if (lastValueRef.current !== value) {
    lastValueRef.current = value;
    setLocal(asString(value));
  }

  const commit = () => {
    const trimmed = local.trim();
    if (trimmed === "") {
      onCommit(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed >= 0) {
      onCommit(parsed);
    } else {
      setLocal(asString(value));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="\d*"
        placeholder="—"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setLocal(asString(value));
          }
        }}
        onBlur={commit}
        className="w-24"
      />
    </div>
  );
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items)).sort();
}

function staticListOptions<K extends readonly unknown[]>(
  queryKey: K,
  items: string[],
) {
  return {
    queryKey,
    queryFn: () => items,
    select: (data: string[]) => data,
  };
}
```

- [ ] **Step 4: Update `traces-search-page.tsx` — header search bar + section shell**

In `traces-search-page.tsx`:

a) Add the import:

```tsx
import { FilterSearchBar } from "../../filters/ui/filter-search-bar";
```

b) Replace the returned JSX (the `<div className="grid …">…</div>` block, lines ~86-128) with a header-bar + grid shell matching Logs/Errors. The `name` value now lives in the header `FilterSearchBar`, and is removed from the `value` object passed to `TraceFilters`:

```tsx
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b bg-muted/10 px-3 py-2">
          <FilterSearchBar
            id="traces-search"
            label="Filter traces by span name"
            value={search.name}
            onChange={(name) => onSearchChange({ name })}
            placeholder="Filter by span name"
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <TraceFilters
            repo={repo}
            timeRange={timeRange}
            value={{
              namespace: search.namespace,
              service: search.service,
              minMs: search.minMs,
              maxMs: search.maxMs,
              status: search.status,
              attributes: search.attributes,
            }}
            identities={identitiesQuery.data ?? []}
            onChange={onSearchChange}
          />
          <main className="flex min-h-0 min-w-0 flex-col">
            <TraceResultsList
              rows={rows}
              isPending={isPending}
              isError={isError}
              error={error}
              refetch={refetch}
              hasMore={hasNextPage}
              isLoadingMore={isFetchingNextPage}
              renderTraceLink={renderTraceLink}
              onLoadMore={() => fetchNextPage()}
              onClearFilters={() =>
                onSearchChange({
                  namespace: [],
                  service: [],
                  name: "",
                  minMs: undefined,
                  maxMs: undefined,
                  status: "all",
                  attributes: [],
                })
              }
            />
          </main>
        </div>
      </section>
    </div>
  );
```

(Note: the results-list `onClearFilters` empty-state escape hatch still resets `name` too — it is a full reset, distinct from the sidebar's Clear all.)

- [ ] **Step 5: Run the traces tests + typecheck**

Run: `pnpm --filter @everr/telemetry-explorer exec vitest run src/traces/ui/trace-filters.test.tsx src/traces/ui/trace-results-list.test.tsx`
Expected: PASS.

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/telemetry-explorer/src/traces/ui/trace-filters.tsx packages/telemetry-explorer/src/traces/ui/trace-filters.test.tsx packages/telemetry-explorer/src/traces/ui/traces-search-page.tsx
git commit -m "Unify traces filter bar with shared sidebar, Environment filter, and header search"
```

---

## Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full telemetry-explorer test suite**

Run: `pnpm --filter @everr/telemetry-explorer test`
Expected: PASS (all existing + new tests green).

- [ ] **Step 2: telemetry-explorer typecheck**

Run: `pnpm --filter @everr/telemetry-explorer typecheck`
Expected: PASS.

- [ ] **Step 3: desktop-app typecheck (no typecheck script — invoke tsc directly)**

Run: `cd packages/desktop-app && pnpm exec tsc --noEmit`
Expected: PASS — confirms the shared-component changes did not break the desktop-app consumer.

- [ ] **Step 4: Manual smoke check (if a dev environment is available)**

On each of Logs, Errors, Traces:
- Confirm the sidebar header reads "Filter" and shows "Clear all" only when filters are active; clicking it resets the sidebar filters (and on Errors leaves the Order/sort untouched).
- Confirm the canonical order renders: Logs (Level → Service → Environment → Trace → Attributes), Errors (Order → Service → Environment → Attributes), Traces (Status → Namespace → Service → Environment → Min/Max ms → Attributes).
- Confirm the Environment combobox populates from real data and filtering by it narrows results; confirm Environment no longer appears as an option in the "Add attribute" picker.
- Confirm free-text search sits in the header bar on all three pages, and on Traces the span-name search works there (the sidebar no longer has a Name input).

- [ ] **Step 5: No commit needed** (verification only). If any step failed, fix the offending task and re-run.

---

## Self-review notes (already applied)

- **Spec coverage:** shared shell (Task 1), free-text home + search (Task 2, wired in 6/7/8), dedicated-attribute split (Task 3), Environment control (Task 4), config promotion (Task 5), per-page refactors with canonical order + clear-all (Tasks 6/7/8), cross-package verification (Task 9). All spec sections map to a task.
- **Type consistency:** the split helper returns `{ dedicated, rest }`; `AttributeValueCombobox` takes `attributeKey` (not `key`, to avoid clashing with React's reserved prop) and the full `attributes` array; `FilterSidebar` props `{ label, hasActiveFilters, onClear, children }`; `FilterSearchBar` props `{ id, label, value, onChange, placeholder }` — used identically across Tasks 6/7/8.
- **Clear-all scope:** sidebar-scoped on every page; header free-text has its own clear "X" (in `FilterSearchBar`). Errors' sort and Traces' span-name are deliberately excluded from sidebar Clear all.
- **No placeholders:** every code step contains full code; every run step has an expected result.
