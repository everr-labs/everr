// packages/app/src/routes/_authenticated/_dashboard/alerts/-cc-shared.tsx
//
// This is a permanent re-export shim for the alerts pages. The
// pieces below live in src/components/cc/{route-resolution,shared} so those
// pages compile without reaching back into route-local modules. This file
// just re-exports them so the alerts pages keep compiling unchanged.
export {
  ccFirstRoute,
  // fallow-ignore-next-line unused-export
  ccMatcherMatches,
  // fallow-ignore-next-line unused-export
  ccOpSymbol,
  // fallow-ignore-next-line unused-export
  ccRouteMatches,
} from "@/components/cc/route-resolution";
export {
  CcConceptNote,
  // fallow-ignore-next-line unused-export
  CcConnectionBadge,
  CcEmptyState,
  // fallow-ignore-next-line unused-export
  CcEventStatusBadge,
  CcHealthBadge,
  CcInstanceStatusBadge,
  CcQueryError,
  CcSeverityBadge,
  CcStatusDot,
  CcTableSkeleton,
  // fallow-ignore-next-line unused-export
  Conditions,
  Conditions as Matchers,
  ccErrorMessage,
  ccFormatTs,
  LabelSet,
} from "@/components/cc/shared";
