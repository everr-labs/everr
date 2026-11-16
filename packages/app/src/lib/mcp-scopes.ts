import { Eye, type LucideIcon, RefreshCw } from "lucide-react";

// Human-readable rendering for the scopes an MCP client can request. Unknown
// scopes fall back to the raw value so consent never hides what's granted.
export const MCP_SCOPE_LABELS: Record<
  string,
  { icon: LucideIcon; label: string; description: string }
> = {
  "observability:read": {
    icon: Eye,
    label: "Read your telemetry",
    description: "Run read-only queries against your organization's traces, logs, and metrics.",
  },
  offline_access: {
    icon: RefreshCw,
    label: "Stay connected",
    description: "Refresh access without you signing in again.",
  },
};
