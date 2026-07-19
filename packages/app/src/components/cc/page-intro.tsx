// packages/app/src/components/cc/page-intro.tsx
//
// The intent layer of the alerting IA. Every alerting page opens the same way:
// its name, the one-sentence job it does, and (optionally) the deeper concept
// prose collapsed behind a "How it works" disclosure. Newcomers get the
// concept exactly where they need it; experts never scroll past a jargon
// banner twice. Inline jargon gets a CcTerm tooltip instead of a footnote.
import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { type ReactNode, useState } from "react";
import { CcDisclosureTrigger } from "./shared";

export function CcPageIntro({
  title,
  lede,
  actions,
  explainer,
  explainerLabel = "How it works",
}: {
  title: string;
  /** One plain-language sentence: the page's job. */
  lede: ReactNode;
  /** Right-aligned page-level actions (primary buttons). */
  actions?: ReactNode;
  /** Deeper concept prose, collapsed by default. */
  explainer?: ReactNode;
  explainerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="space-y-1">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="space-y-0.5">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="max-w-prose text-xs text-muted-foreground">{lede}</p>
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {explainer && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CcDisclosureTrigger
            open={open}
            variant="bare"
            className="-ml-1 text-muted-foreground"
          >
            {explainerLabel}
          </CcDisclosureTrigger>
          <CollapsibleContent>
            <div className="mt-1 max-w-prose rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.6875rem] [&_strong]:font-medium [&_strong]:text-foreground [&_p+p]:mt-2">
              {explainer}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </header>
  );
}

/**
 * An inline technical term with its definition one hover away: dotted
 * underline, tooltip. Keeps real vocabulary (burn rate, error budget,
 * matcher) in the UI without demanding the reader already knows it.
 */
export function CcTerm({
  children,
  def,
}: {
  children: ReactNode;
  def: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="cursor-help underline decoration-muted-foreground/50 decoration-dotted underline-offset-2" />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{def}</TooltipContent>
    </Tooltip>
  );
}
