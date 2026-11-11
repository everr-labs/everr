import { CopyValueButton } from "@everr/ui/components/detail-panel";
import { Input } from "@everr/ui/components/input";
import { useState } from "react";
import type { ErrorOccurrence } from "../data/types";
import { ErrorDetailSection } from "./error-detail-section";

// The page shows these attributes in the header and in the stack trace
// sections, in a form that is easier to read than a table cell.
const SHOWN_ELSEWHERE: ReadonlySet<string> = new Set([
  "exception.type",
  "exception.message",
  "exception.stacktrace",
  "everr.react.component_stack",
]);

// Below this number of attributes the user can read all of them at once, and
// a filter field has no use.
const FILTER_MIN_ATTRIBUTES = 8;

type AttributeGroup = { title: string; entries: [string, string][] };

function sortedEntries(map: Record<string, string>, hidden?: ReadonlySet<string>) {
  return Object.entries(map)
    .filter(([key]) => !hidden?.has(key))
    .sort(([a], [b]) => a.localeCompare(b));
}

export function ErrorAttributes({ occurrence }: { occurrence: ErrorOccurrence }) {
  const [filter, setFilter] = useState("");

  const groups: AttributeGroup[] = [
    { title: "Log", entries: sortedEntries(occurrence.logAttributes, SHOWN_ELSEWHERE) },
    { title: "Resource", entries: sortedEntries(occurrence.resourceAttributes) },
    { title: "Scope", entries: sortedEntries(occurrence.scopeAttributes) },
  ].filter((group) => group.entries.length > 0);
  const total = groups.reduce((count, group) => count + group.entries.length, 0);
  if (total === 0) return null;

  // The filter stays in state when the pager moves to an occurrence with fewer
  // attributes. That occurrence shows no filter field, so it ignores the
  // filter: a value that the user cannot see or clear must not hide rows.
  const showFilter = total >= FILTER_MIN_ATTRIBUTES;
  const needle = showFilter ? filter.trim().toLowerCase() : "";
  const visible = needle
    ? groups
        .map((group) => ({
          ...group,
          entries: group.entries.filter(
            ([key, value]) =>
              key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle),
          ),
        }))
        .filter((group) => group.entries.length > 0)
    : groups;

  return (
    <ErrorDetailSection
      title="Attributes"
      description={<span className="tabular-nums">{total}</span>}
      actions={
        showFilter ? (
          <Input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter attributes"
            aria-label="Filter attributes"
            className="h-7 w-56"
          />
        ) : null
      }
    >
      {visible.length === 0 ? (
        <p className="text-muted-foreground rounded-md border px-3 py-2 text-xs">
          No attribute matches “{filter.trim()}”.
        </p>
      ) : (
        <div className="divide-y overflow-hidden rounded-md border text-xs">
          {visible.map((group) => (
            <section key={group.title} aria-label={`${group.title} attributes`}>
              <h3 className="bg-muted/30 text-muted-foreground flex items-center gap-2 border-b px-3 py-1 font-medium">
                {group.title}
                <span className="font-normal tabular-nums">{group.entries.length}</span>
              </h3>
              <dl className="divide-y font-mono leading-5">
                {group.entries.map(([key, value]) => (
                  <div
                    key={key}
                    className="group hover:bg-muted/30 relative grid gap-x-4 py-1.5 pr-9 pl-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
                  >
                    <dt className="text-muted-foreground min-w-0 break-words">{key}</dt>
                    {/* The value keeps its line breaks, and a run with no
                        place to wrap (an ID, a URL) breaks anywhere. */}
                    <dd className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
                      {value}
                    </dd>
                    <CopyValueButton value={value} className="absolute top-1.5 right-2" />
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </ErrorDetailSection>
  );
}
