import { raggedWidth, Skeleton } from "@everr/ui/components/skeleton";
import { kickerClass } from "@everr/ui/lib/typography";
import { cn } from "@everr/ui/lib/utils";
import { createLink, type LinkComponentProps, type RegisteredRouter } from "@tanstack/react-router";
import type { ComponentPropsWithRef, ReactElement } from "react";

/** The look every navigable row in a rail shares, matching the app sidebar:
 *  a dimmed label and icon that brighten on hover, and a press that fills the
 *  row with the selected row's background, so a click flows straight into the
 *  selected state. The selected look keys on the `data-status` a router link
 *  sets, which outranks the hover and rest classes whatever their order. */
export const railRowClass = cn(
  // In a phone's side drawer the row grows to a 40px touch target, the same
  // height as the sidebar's rows there.
  "rounded-md py-1.5 in-data-side-drawer:min-h-10 text-foreground/75 [&>svg]:text-foreground/60 transition-[background-color,color] duration-200 ease-sidebar motion-reduce:transition-none",
  "hover:bg-muted/50 hover:text-foreground hover:[&>svg]:text-foreground active:bg-muted active:text-foreground",
  "data-[status=active]:bg-muted data-[status=active]:text-foreground data-[status=active]:[&>svg]:text-primary",
);

/** The heading over a group of rail rows. */
export const groupLabelClass = kickerClass;

/**
 * Left padding of a row at `depth`. A folder's disclosure chevron sits in the
 * gutter a resource row does not have, so the two start at different offsets
 * and step by the same amount.
 */
export const rowIndent = (depth: number, kind: "resource" | "folder") =>
  depth * 20 + (kind === "folder" ? 4 : 26);

/**
 * One rail row that is not part of a tree: a plain labelled destination.
 *
 * A caller's `className` is merged rather than dropped. `activeProps` is not
 * accepted at all: the active look is what makes a rail row a rail row, so
 * overriding it is a type error rather than something that silently happens.
 */
type RailRowAnchorProps = ComponentPropsWithRef<"a"> & {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeProps?: never;
};

function RailRowAnchor({ label, icon: Icon, className, ...anchorProps }: RailRowAnchorProps) {
  return (
    <a
      {...anchorProps}
      className={cn(railRowClass, "flex w-full items-center gap-2.5 px-2 text-left", className)}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
    </a>
  );
}

export const RailRow: <
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(
  props: LinkComponentProps<
    typeof RailRowAnchor,
    RegisteredRouter,
    TFrom,
    TTo,
    TMaskFrom,
    TMaskTo
  > & { activeProps?: never },
) => ReactElement = createLink(RailRowAnchor);

/** Matches the real row height, including its 40px touch target in a drawer. */
export function RailRowsSkeleton({ count = 3, label }: { count?: number; label: string }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="flex min-h-8 items-center gap-2.5 px-2 in-data-side-drawer:min-h-10"
          >
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-3 rounded-sm" style={{ width: raggedWidth(i, 55, 85) }} />
          </div>
        ))}
      </div>
    </div>
  );
}
