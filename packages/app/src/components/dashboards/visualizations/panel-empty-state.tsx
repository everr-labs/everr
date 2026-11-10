import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import type { LucideIcon } from "lucide-react";
import type { QueryResultRow } from "./index";

/**
 * What a panel shows when it has nothing to draw, and why: no query, a query
 * that returned no rows, or rows the visualization cannot use. `unusable`
 * says what the visualization needed from those rows.
 *
 * It sizes against its own box, so short panels drop the icon first and then
 * the explanation, keeping the title readable.
 */
export function PanelEmptyState({
  icon: Icon,
  data,
  unusable = "The result has no values this panel can draw.",
}: {
  icon: LucideIcon;
  data: QueryResultRow[][] | undefined;
  unusable?: string;
}) {
  const [title, description] = !data
    ? ["No query", "Add a query to this panel to see results."]
    : data.every((frame) => frame.length === 0)
      ? ["No data", "The query returned no rows for this time range."]
      : ["Nothing to draw", unusable];

  return (
    // No minimum height: it would keep a short panel from dropping the text.
    // A caller whose height isn't set gives it one, since a size container
    // has no height of its own.
    <Empty className="relative h-full gap-3 overflow-hidden p-4 [container-type:size]">
      {/* A faint dot grid, like an empty plot area, fading out from the middle. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[14px_14px] mask-[radial-gradient(ellipse_at_center,black_10%,transparent_70%)]"
      />
      <EmptyMedia className="relative mb-0 flex size-10 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-xs ring-1 ring-border [@container(max-height:9.5rem)]:hidden">
        <Icon className="size-5" strokeWidth={1.75} />
      </EmptyMedia>
      <EmptyHeader className="relative gap-1">
        <EmptyTitle className="text-foreground">{title}</EmptyTitle>
        <EmptyDescription className="max-w-[34ch] text-balance [@container(max-height:4.5rem)]:hidden">
          {description}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
