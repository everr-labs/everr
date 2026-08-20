import { cn } from "@everr/ui/lib/utils";
import { Link, type LinkProps } from "@tanstack/react-router";

/** The look every navigable row in a rail shares. */
export const railRowClass =
  "rounded-md py-1.5 transition-colors hover:bg-muted/50";
export const railRowActiveProps = {
  className: "bg-muted text-foreground [&>svg]:text-primary",
};

/** The heading over a group of rail rows. */
export const groupLabelClass =
  "font-semibold text-[0.6875rem] text-foreground/75 uppercase tracking-wider";

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
export function RailRow({
  label,
  icon: Icon,
  className,
  ...linkProps
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
} & Omit<LinkProps, "className" | "activeProps">) {
  return (
    <Link
      {...linkProps}
      className={cn(
        railRowClass,
        "flex w-full items-center gap-2.5 px-2 text-left text-foreground",
        className,
      )}
      activeProps={railRowActiveProps}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
    </Link>
  );
}
