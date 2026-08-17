import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { useState } from "react";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import type { AlertingRuleView } from "@/data/alerting/types";
import { AlertingDisclosureTrigger } from "../shared/components";

export function RuleMetaLine({ rule }: { rule: AlertingRuleView }) {
  const facts = [
    rule.spec.severity,
    `every ${formatDurationSeconds(rule.spec.interval_secs)}`,
    rule.spec.max_interval_secs != null
      ? `up to ${formatDurationSeconds(rule.spec.max_interval_secs)}`
      : null,
    `for ${formatDurationSeconds(rule.spec.for_secs)}`,
    `resolves after ${rule.spec.resolve_after} missed ${
      rule.spec.resolve_after === 1 ? "evaluation" : "evaluations"
    }`,
    rule.notification_channels.length > 0
      ? `to ${rule.notification_channels.join(", ")}`
      : "advanced routing",
  ].filter((f): f is string => f !== null);

  return <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>;
}

export function RuleReferenceDisclosures({ rule }: { rule: AlertingRuleView }) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const annotationEntries = Object.entries(rule.spec.annotations ?? {});

  return (
    <div className="space-y-3">
      {annotationEntries.length > 0 && (
        <Collapsible open={annotationsOpen} onOpenChange={setAnnotationsOpen}>
          <AlertingDisclosureTrigger open={annotationsOpen}>
            <span className="text-xs font-medium">Annotations</span>
            {!annotationsOpen && (
              <span className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
                {annotationEntries.length} metadata field
                {annotationEntries.length === 1 ? "" : "s"}
              </span>
            )}
          </AlertingDisclosureTrigger>
          <CollapsibleContent>
            <dl className="mt-2 divide-y divide-border/60 rounded-md bg-muted/30 px-3 ring-1 ring-foreground/10">
              {annotationEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3"
                >
                  <dt className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground sm:w-40">
                    {key}
                  </dt>
                  <dd className="min-w-0 break-words text-xs [overflow-wrap:anywhere]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      )}
      <Collapsible open={sqlOpen} onOpenChange={setSqlOpen}>
        <AlertingDisclosureTrigger open={sqlOpen}>
          <span className="text-xs font-medium">Query</span>
          {!sqlOpen && (
            <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground">
              {rule.spec.sql}
            </span>
          )}
        </AlertingDisclosureTrigger>
        <CollapsibleContent>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs ring-1 ring-foreground/10">
            {rule.spec.sql}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
