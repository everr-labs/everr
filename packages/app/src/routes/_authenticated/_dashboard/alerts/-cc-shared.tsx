// packages/app/src/routes/_authenticated/_dashboard/alerts/-cc-shared.tsx
//
// This is a permanent re-export shim for the alerts pages. The
// pieces below live in src/components/cc/{route-resolution,shared} so those
// pages compile without reaching back into route-local modules. This file
// just re-exports them so the alerts pages keep compiling unchanged.
export {
  CcConceptNote,
  CcEmptyState,
  CcHealthBadge,
  CcInstanceStatusBadge,
  CcQueryError,
  CcSeverityBadge,
  CcStatusDot,
  CcTableSkeleton,
  Conditions as Matchers,
  ccErrorMessage,
  ccFormatDuration,
  ccFormatTs,
  LabelSet,
} from "@/components/cc/shared";
