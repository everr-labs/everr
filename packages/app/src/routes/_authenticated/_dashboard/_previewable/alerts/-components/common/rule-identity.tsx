import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import { PreviewStatusBadge } from "@/components/preview-status-badge";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import type {
  AlertingRuleHealthStatus,
  AlertingRuleView,
} from "@/data/alerting/types";
import { AlertingHealthHeart, AlertingSeverityBadge } from "./status";

/**
 * The identity cluster every rule-shaped row leads with: name, preview badge,
 * health heart, severity (info stays silent), and the evaluation cadence.
 * Shared by the rules list and the triage board so the two surfaces cannot
 * drift apart.
 */
export function AlertingRuleIdentity({
  name,
  params,
  linkClassName,
  onLinkClick,
  previewStatus,
  healthStatus,
  severity,
  intervalSecs,
}: {
  name: string;
  /** Route params for the rule page; without them the name is plain text. */
  params: { project: string; slug: string } | null;
  linkClassName?: string;
  onLinkClick?: (e: MouseEvent) => void;
  previewStatus?: AlertingRuleView["previewStatus"];
  healthStatus?: AlertingRuleHealthStatus;
  severity: AlertingRuleView["spec"]["severity"];
  intervalSecs?: number;
}) {
  return (
    <>
      {params ? (
        <Link
          to="/alerts/rules/$project/$slug"
          params={params}
          onClick={onLinkClick}
          className={cn(
            "min-w-0 text-sm font-medium text-foreground underline-offset-2 hover:underline",
            linkClassName,
          )}
        >
          {name}
        </Link>
      ) : (
        <span className="text-sm font-medium text-foreground">{name}</span>
      )}
      {previewStatus !== undefined && (
        <PreviewStatusBadge status={previewStatus} />
      )}
      <AlertingHealthHeart status={healthStatus} />
      {severity !== "info" && <AlertingSeverityBadge severity={severity} />}
      {intervalSecs !== undefined && (
        <span className="text-[0.6875rem] text-muted-foreground">
          Every {formatDurationSeconds(intervalSecs)}
        </span>
      )}
    </>
  );
}
