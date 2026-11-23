import { ScrollArea } from "@everr/ui/components/scroll-area";
import { cn } from "@everr/ui/lib/utils";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import type * as React from "react";
import type { ReactNode } from "react";

// Title is fixed at the DESIGN.md page scale (Inter 700, text-xl, fixed rem):
// per-page heading sizes are what this component exists to prevent.
export function PageHeader({
  title,
  lede,
  icon: Icon,
  actions,
  docsHref,
  docsLabel = "Learn more",
  className,
}: {
  title: ReactNode;
  /** One plain-language sentence: the page's job. */
  lede?: ReactNode;
  icon?: LucideIcon;
  /** Right-aligned page-level actions (primary buttons). */
  actions?: ReactNode;
  docsHref?: string;
  docsLabel?: string;
  className?: string;
}) {
  return (
    <header className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="space-y-0.5">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            {Icon && <Icon aria-hidden className="size-5 text-muted-foreground" />}
            {title}
          </h1>
          {lede && <p className="max-w-prose text-sm text-muted-foreground">{lede}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {docsHref && (
        <a
          href={docsHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-xs text-muted-foreground underline-offset-2 outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-primary"
        >
          {docsLabel}
          <ArrowUpRight className="size-3" />
        </a>
      )}
    </header>
  );
}

// The standard page inset (12px gutter + gap), in one place. `flex-1 min-h-0`
// keeps fill semantics so pages with their own internal scroll can size to the
// scroll column.
export function PageContainer({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3 p-3", className)} {...props}>
      {children}
    </div>
  );
}

// The same inset in a scroll column of its own, for the layouts whose parent
// column is `overflow-hidden` and so cannot scroll for them. The viewport is a
// flex column so PageContainer's fill semantics keep working: without it
// `flex-1` is inert and the inset sizes to its content instead of the column.
export function ScrollingPageContainer({
  children,
  ...props
}: React.ComponentProps<typeof PageContainer>) {
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="flex flex-col overscroll-y-contain">
      <PageContainer {...props}>{children}</PageContainer>
    </ScrollArea>
  );
}
