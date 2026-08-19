import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { toneText } from "@everr/ui/components/tone";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import {
  extractVariables,
  splitTemplate,
} from "@/data/alerting/delivery/template";
import { partitionAnnotations } from "@/data/alerting/resource-annotations";
import { fromAlertingRule } from "@/data/alerting/rules/resource/mapping";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import type { AlertingRuleView } from "@/data/alerting/types";
import { AlertingDisclosureTrigger } from "../common/disclosure";
import { LabelSet } from "../common/labels";
import { alertingSeverityTone } from "../common/status";
import { AlertingSummaryLabel } from "../common/summary-card";

function RuleFact({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  /** A qualifier on the value, such as the backoff ceiling on an interval. */
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt>
        <AlertingSummaryLabel>{label}</AlertingSummaryLabel>
      </dt>
      <dd className="mt-0.5 text-xs font-medium tabular-nums">
        {value}
        {hint && (
          <span className="ml-1.5 font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * How the rule behaves, as named facts rather than one run of text: each one
 * is a different dimension (cadence, patience, resolution, destination) and
 * only reads as a fact when its name travels with it.
 */
export function RuleDefinitionFacts({ rule }: { rule: AlertingRuleView }) {
  const { for_secs, resolve_after, severity } = rule.spec;
  const channels = rule.spec.notifications?.channels ?? [];

  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2">
      <RuleFact
        label="Severity"
        // The word alone, not the dotted badge: a leading dot would push the
        // value out of line with the labels the other facts align to.
        value={
          <span className={toneText({ tone: alertingSeverityTone(severity) })}>
            {severity}
          </span>
        }
      />
      <RuleFact
        label="Every"
        value={formatDurationSeconds(rule.spec.interval_secs)}
        hint={
          rule.spec.max_interval_secs != null
            ? `up to ${formatDurationSeconds(rule.spec.max_interval_secs)}`
            : undefined
        }
      />
      <RuleFact
        label="Fires after"
        // `for: 0` is not a duration to read, it is the absence of one.
        value={for_secs > 0 ? formatDurationSeconds(for_secs) : "first breach"}
      />
      <RuleFact
        label="Resolves after"
        // Not "missed": the evaluation ran. The instance either left the
        // results or came back no longer matching the condition, which the
        // engine counts the same way (`absentCount`).
        value={`${resolve_after} non-breaching ${
          resolve_after === 1 ? "evaluation" : "evaluations"
        }`}
      />
      <RuleFact
        label="Notifies"
        value={
          channels.length > 0 ? (
            channels.join(", ")
          ) : (
            // No direct channels means the default destination delivers,
            // which is a page the reader can go read.
            <Link
              to="/alerts/notifications"
              className="font-normal underline decoration-foreground/30 underline-offset-2 transition-colors duration-150 hover:decoration-foreground"
            >
              Default destination
            </Link>
          )
        }
      />
    </dl>
  );
}

/** metadata.labels, which identify the rule rather than describe it. */
export function RuleLabels({ rule }: { rule: AlertingRuleView }) {
  const { labels } = partitionAnnotations(rule.spec.annotations);
  if (Object.keys(labels).length === 0) return null;
  return <LabelSet labels={labels} />;
}

/**
 * A message template as authored: literal text with its `${column}`
 * placeholders marked, so nobody reads an unfilled placeholder as the message.
 */
function MessageTemplate({ template }: { template: string }) {
  return (
    <span className="text-xs [overflow-wrap:anywhere]">
      {splitTemplate(template).map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <code
            key={index}
            // Padded only enough to read as a token: a wider inset would open
            // a gap before the punctuation that follows a placeholder.
            className="rounded-[3px] bg-muted px-0.5 py-px font-mono text-[0.6875rem] text-foreground ring-1 ring-foreground/10"
          >
            {`\${${segment.value}}`}
          </code>
        ),
      )}
    </span>
  );
}

function DefinitionRow({
  term,
  children,
}: {
  term: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground sm:w-40">
        {term}
      </dt>
      <dd className="min-w-0 break-words text-xs [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

const DEFINITION_LIST_CLASS =
  "mt-2 divide-y divide-border/60 rounded-md bg-muted/30 px-3 ring-1 ring-foreground/10";

/** An annotation value that is safe to offer as a link. */
function annotationHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

export function RuleReferenceDisclosures({ rule }: { rule: AlertingRuleView }) {
  const [messageOpen, setMessageOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const view = fromAlertingRule(rule);
  // Only what a person wrote. The rest of the stored annotations are generated
  // from fields this page already shows in their own place.
  const { custom } = partitionAnnotations(rule.spec.annotations);
  const customEntries = Object.entries(custom);
  const hasPlaceholders =
    extractVariables(
      `${view.notificationTitleTemplate}${view.notificationDescriptionTemplate}`,
    ).length > 0;

  return (
    <div className="space-y-3">
      {view.notificationTitleTemplate && (
        <Collapsible open={messageOpen} onOpenChange={setMessageOpen}>
          <AlertingDisclosureTrigger open={messageOpen}>
            <span className="shrink-0 text-xs font-medium">
              Notification message
            </span>
            {!messageOpen && (
              <span className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
                {view.notificationTitleTemplate}
              </span>
            )}
          </AlertingDisclosureTrigger>
          <CollapsibleContent>
            <dl className={DEFINITION_LIST_CLASS}>
              <DefinitionRow term="title">
                <MessageTemplate template={view.notificationTitleTemplate} />
              </DefinitionRow>
              {view.notificationDescriptionTemplate && (
                <DefinitionRow term="description">
                  <MessageTemplate
                    template={view.notificationDescriptionTemplate}
                  />
                </DefinitionRow>
              )}
            </dl>
            {(hasPlaceholders || rule.previewId !== null) && (
              <p className="mt-1.5 max-w-prose text-[0.6875rem] text-muted-foreground">
                {hasPlaceholders &&
                  "Each placeholder is filled from the query result row that breached the condition."}
                {hasPlaceholders && rule.previewId !== null && " "}
                {rule.previewId !== null &&
                  "A preview rule never notifies, so this is the message the live rule would send."}
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {customEntries.length > 0 && (
        <Collapsible open={annotationsOpen} onOpenChange={setAnnotationsOpen}>
          <AlertingDisclosureTrigger open={annotationsOpen}>
            <span className="shrink-0 text-xs font-medium">Annotations</span>
            {!annotationsOpen && (
              <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground">
                {customEntries.map(([key]) => key).join(", ")}
              </span>
            )}
          </AlertingDisclosureTrigger>
          <CollapsibleContent>
            <dl className={DEFINITION_LIST_CLASS}>
              {customEntries.map(([key, value]) => {
                const href = annotationHref(value);
                return (
                  <DefinitionRow key={key} term={key}>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground underline underline-offset-2 decoration-foreground/30 transition-colors duration-150 hover:decoration-foreground"
                      >
                        {value}
                      </a>
                    ) : (
                      value
                    )}
                  </DefinitionRow>
                );
              })}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
