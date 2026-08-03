// Title is fixed at the DESIGN.md page scale (Inter 700, text-xl, fixed rem):
// per-page heading sizes are what this component exists to prevent.
import { cn } from "@everr/ui/lib/utils";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
            {Icon && (
              <Icon aria-hidden className="size-5 text-muted-foreground" />
            )}
            {title}
          </h1>
          {lede && (
            <p className="max-w-prose text-sm text-muted-foreground">{lede}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
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
