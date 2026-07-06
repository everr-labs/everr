// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/-cc-shared.tsx
//
// This route folder is slated for deletion once the unified alerting pages
// land; the pieces below moved to src/components/cc/{route-resolution,shared}
// so those pages compile without reaching into a doomed route. This file just
// re-exports so the remaining cc-alerting pages keep compiling unchanged.
export {
  ccFirstRoute,
  ccMatcherMatches,
  ccOpSymbol,
  ccRouteMatches,
} from "@/components/cc/route-resolution";
export {
  CcConceptNote,
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
