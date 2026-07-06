// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/-cc-shared.tsx
//
// This route folder is slated for deletion once the unified alerting pages
// land; the pieces below moved to src/components/cc/{route-resolution,shared}
// so those pages compile without reaching into a doomed route. This file just
// re-exports so the remaining cc-alerting pages keep compiling unchanged.
import { cn } from "@everr/ui/lib/utils";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

export {
  ccFirstRoute,
  ccMatcherMatches,
  ccOpSymbol,
  ccRouteMatches,
} from "@/components/cc/route-resolution";
export {
  CcConnectionBadge,
  CcEmptyState,
  CcEventStatusBadge,
  CcHealthBadge,
  CcInstanceStatusBadge,
  CcQueryError,
  CcSeverityBadge,
  CcStatusDot,
  CcTableSkeleton,
  Conditions,
  Conditions as Matchers,
  ccErrorMessage,
  ccFormatTs,
  LabelSet,
} from "@/components/cc/shared";

// ── Guidance ──────────────────────────────────────────────────────────────────
// Plain-language, always-visible explainers. Alerting is hard; the UI should
// teach the concept in place rather than expose a raw control and hope.

export function CcConceptNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Info className="mt-px size-3.5 shrink-0 text-muted-foreground/70" />
      <div className="[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.6875rem] [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </div>
  );
}
