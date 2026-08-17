import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
import { InhibitionsSection } from "./-components/delivery/inhibitions-section";
import { PipelineSection } from "./-components/delivery/pipeline-section";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/routing",
)({
  // Routes/receivers/channels/inhibitions are live operational config, not an
  // as-code resource a preview branch overlays (the `preview` param this
  // loader threads through is only for the alert/rule context it displays
  // alongside them), so the preview banner would be misleading here.
  staticData: { breadcrumb: "Routing", hidePreviewFrame: true },
  head: () => ({ meta: [{ title: "Everr - Alert routing" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(deliveryQueries.routes()),
      queryClient.prefetchQuery(deliveryQueries.receivers()),
      queryClient.prefetchQuery(deliveryQueries.channels()),
      queryClient.prefetchQuery(deliveryQueries.inhibitions()),
      queryClient.prefetchQuery(alertInstanceQueries.list(deps.preview)),
      queryClient.prefetchQuery(ruleQueries.rules(deps.preview)),
    ]),
  component: AlertingRoutingPage,
});

function AlertingRoutingPage() {
  const navigate = Route.useNavigate();
  const { preview } = Route.useSearch();
  const routes = useQuery(deliveryQueries.routes());
  const receivers = useQuery(deliveryQueries.receivers());
  const channels = useQuery(deliveryQueries.channels());
  const alerts = useQuery(alertInstanceQueries.list(preview));
  const rules = useQuery(ruleQueries.rules(preview));

  const [previewLabels, setPreviewLabels] = useState<Record<string, string>>(
    {},
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
        title="Routing"
        lede="Which alerts reach which receiver, and which alerts suppress others."
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
        onAddChannel={() =>
          navigate({
            to: "/alerts/notifications",
            search: { new: "channel" },
          })
        }
        onAddReceiver={() =>
          navigate({
            to: "/alerts/notifications",
            search: { new: "receiver" },
          })
        }
      />
      <InhibitionsSection />
    </div>
  );
}
