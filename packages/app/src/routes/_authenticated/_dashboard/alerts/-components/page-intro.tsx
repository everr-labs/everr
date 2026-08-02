// packages/app/src/routes/_authenticated/_dashboard/alerts/-components/page-intro.tsx
//
// The intent layer of the alerting IA. Every alerting page opens the same way:
// its name, the one-sentence job it does, and a "Learn more" link to the
// concept it belongs to. The depth lives in the docs (everr.dev/docs), not in
// an in-app disclosure, so the page stays a working surface and the
// explanation stays in one canonical, versioned place.
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function CcPageIntro({
  title,
  lede,
  actions,
  docsHref,
  docsLabel = "Learn more",
}: {
  title: string;
  /** One plain-language sentence: the page's job. */
  lede: ReactNode;
  /** Right-aligned page-level actions (primary buttons). */
  actions?: ReactNode;
  /** Docs URL for the concept behind this page (everr.dev/docs/...). */
  docsHref?: string;
  /** Link text; defaults to "Learn more". */
  docsLabel?: string;
}) {
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
