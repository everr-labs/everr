import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import { alertInstanceQueries } from "@/data/alerting/instances/queries";
import {
  alertingDispatchLabels,
  alertingSelectRoutes,
} from "@/data/alerting/routing/resolution";
import { alertingRuleIdentity } from "@/data/alerting/rules/identity";
import { ruleQueries } from "@/data/alerting/rules/queries";
import type { AlertingChannel, AlertingReceiver } from "@/data/alerting/types";
import { ChannelsSection } from "./-components/delivery/channels-section";
import { InhibitionsSection } from "./-components/delivery/inhibitions-section";
import { PipelineSection } from "./-components/delivery/pipeline-section";
import { ReceiversSection } from "./-components/delivery/receivers-section";
import { AlertingDisclosureTrigger } from "./-components/shared/components";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/delivery",
)({
  staticData: { breadcrumb: "Delivery" },
  head: () => ({ meta: [{ title: "Everr - Alerting Delivery" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(deliveryQueries.routes()),
      queryClient.prefetchQuery(deliveryQueries.receivers()),
      queryClient.prefetchQuery(deliveryQueries.channels()),
      queryClient.prefetchQuery(deliveryQueries.inhibitions()),
      queryClient.prefetchQuery(alertInstanceQueries.list(deps.preview)),
      queryClient.prefetchQuery(ruleQueries.rules()),
    ]),
  component: AlertingDeliveryPage,
});

function AlertingDeliveryPage() {
  const location = useLocation();
  const { preview } = Route.useSearch();
  const routes = useQuery(deliveryQueries.routes());
  const receivers = useQuery(deliveryQueries.receivers());
  const channels = useQuery(deliveryQueries.channels());
  const alerts = useQuery(alertInstanceQueries.list(preview));
  const rules = useQuery(ruleQueries.rules());

  const [previewLabels, setPreviewLabels] = useState<Record<string, string>>(
    {},
  );
  const [receiverEditing, setReceiverEditing] = useState<
    AlertingReceiver | "new" | null
  >(null);
  const [channelEditing, setChannelEditing] = useState<
    AlertingChannel | "new" | null
  >(null);
  const [advancedOpen, setAdvancedOpen] = useState(
    () => location.hash === "inhibitions",
  );

  const matchedRoutes = useMemo(
    () =>
      Object.keys(previewLabels).length > 0
        ? alertingSelectRoutes(routes.data ?? [], previewLabels)
        : [],
    [routes.data, previewLabels],
  );

  const prefill = useMemo(() => {
    const firing = (alerts.data ?? []).find((a) => a.status === "firing");
    if (!firing) return null;
    const rule = (rules.data ?? []).find((r) => r.id === firing.rule);
    return alertingDispatchLabels(firing, rule);
  }, [alerts.data, rules.data]);

  const channelsByName = useMemo(
    () => new Map((channels.data ?? []).map((c) => [c.name, c])),
    [channels.data],
  );
  const previewValueNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const rule of rules.data ?? []) {
      names.set(rule.id, alertingRuleIdentity(rule).name);
    }
    return names;
  }, [rules.data]);
  return (
    <div className="space-y-3">
      <PageHeader
        title="Delivery"
        lede="Who gets told about a firing alert, and how: routes match alerts to receivers, receivers fan out to channels."
        docsHref="https://everr.dev/docs/guides/set-up-notifications"
      />

      <PipelineSection
        receivers={receivers.data ?? []}
        channelsByName={channelsByName}
        previewLabels={previewLabels}
        onPreviewLabelsChange={setPreviewLabels}
        matchedRoutes={matchedRoutes}
        prefill={prefill}
        previewValueNames={previewValueNames}
        coveragePending={
          routes.isPending || receivers.isPending || channels.isPending
        }
        coverageUnavailable={
          routes.isError || receivers.isError || channels.isError
        }
        onAddChannel={() => setChannelEditing("new")}
        onAddReceiver={() => setReceiverEditing("new")}
      />

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ReceiversSection
          channels={channels.data ?? []}
          routes={routes.data}
          editing={receiverEditing}
          onEditingChange={setReceiverEditing}
          onReviewRoutes={() =>
            document
              .getElementById("routes")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        />
        <ChannelsSection
          receivers={receivers.data}
          editing={channelEditing}
          onEditingChange={setChannelEditing}
          onEditReceiver={setReceiverEditing}
        />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <AlertingDisclosureTrigger open={advancedOpen} className="bg-card">
          <span className="text-xs font-medium">Advanced delivery</span>
          <span className="text-xs text-muted-foreground">inhibitions</span>
        </AlertingDisclosureTrigger>
        <CollapsibleContent>
          <div className="space-y-3 pt-3">
            <InhibitionsSection />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
