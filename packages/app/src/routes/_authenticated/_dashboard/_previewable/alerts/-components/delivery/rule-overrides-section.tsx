import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@everr/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { alertingRuleIdentity } from "@/data/alerting/rules/identity";
import { ruleQueries } from "@/data/alerting/rules/queries";
import { SectionHeading } from "../common/section-heading";
import { SectionBody } from "./section-chrome";

/**
 * Read-only: overrides are set in the rule's YAML (`notifications.channels`)
 * and applied as code, so this card only says which rules opted out.
 */
export function RuleOverridesSection() {
  const { data, isPending, isError, error } = useQuery(ruleQueries.rules());
  const overriding = (data ?? []).filter(
    (rule) => rule.spec.notifications !== undefined,
  );

  return (
    <Card id="rule-overrides" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <SectionHeading>Rule overrides</SectionHeading>
        <CardDescription>
          Rules that name their own channels skip the default destination. Set
          with <span className="font-mono">notifications.channels</span> in the
          rule&rsquo;s YAML.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={2}
          empty={{
            when: overriding.length === 0,
            icon: CheckCircle2,
            title: "No overrides",
            hint: "Every rule delivers to the default destination.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {overriding.map((rule) => {
              const identity = alertingRuleIdentity(rule);
              return (
                <li
                  key={rule.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Link
                    to="/alerts/rules/$project/$slug"
                    params={{ project: identity.project, slug: identity.slug }}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {identity.name}
                  </Link>
                  <span aria-hidden className="text-muted-foreground/70">
                    &rarr;
                  </span>
                  <span className="min-w-0 max-w-[50%] truncate font-mono text-xs text-muted-foreground">
                    {rule.spec.notifications?.channels.join(", ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionBody>
      </CardContent>
    </Card>
  );
}
