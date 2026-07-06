// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/-cc-shared.tsx
//
// This is a permanent re-export shim for the advanced alerting pages. The
// pieces below live in src/components/cc/{route-resolution,shared} so those
// pages compile without reaching back into route-local modules. This file
// just re-exports them so the cc-alerting pages keep compiling unchanged.
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
