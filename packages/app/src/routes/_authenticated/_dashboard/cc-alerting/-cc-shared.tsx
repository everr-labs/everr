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
  CcAlertingTabs,
  CcConceptNote,
  CcConnectionBadge,
  CcEmptyState,
  CcEventStatusBadge,
  CcInstanceStatusBadge,
  CcQueryError,
  CcRuleHealthDot,
  CcSeverityBadge,
  CcStatusDot,
  CcTableSkeleton,
  Conditions,
  Conditions as Matchers,
  ccErrorMessage,
  ccFormatTs,
  formatInterval,
  LabelSet,
  RelativeTime,
  ruleDisplayName,
} from "@/components/cc/shared";
