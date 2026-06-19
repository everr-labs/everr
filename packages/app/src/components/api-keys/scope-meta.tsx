import { FileCode2, type LucideIcon, RadioTower } from "lucide-react";
import type { ApiKeyScope } from "@/lib/api-key-scopes";

/**
 * Icon per capability scope, shared by the create dialog and the keys table so
 * a scope always reads the same way. Labels and descriptions live next to the
 * scope definition in `@/lib/api-key-scopes`.
 */
export const SCOPE_ICONS: Record<ApiKeyScope, LucideIcon> = {
  ingest: RadioTower,
  apply: FileCode2,
};
