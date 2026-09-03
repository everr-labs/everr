import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { LEDGER_DATA, LEDGER_EMPTY } from "./-prototype/notifications/fixtures";
import { VariantLedger } from "./-prototype/notifications/variant-ledger";
import { VariantMap } from "./-prototype/notifications/variant-map";
import { VariantMatrix } from "./-prototype/notifications/variant-matrix";

// PROTOTYPE. Three variants of the Notifications page on this route,
// switchable via `?variant=`, rendered from synthetic fixtures. The question:
// how do the default destination, the channels, the rule overrides and the
// delivery record in range share one screen?
const VARIANTS = [
  { key: "ledger", name: "Ledger · channel rows" },
  { key: "map", name: "Map · drawn routes" },
  { key: "matrix", name: "Matrix · tiers × channels" },
] as const;

type VariantKey = (typeof VARIANTS)[number]["key"];

const NotificationsSearchSchema = z.object({
  variant: z
    .enum(VARIANTS.map((v) => v.key) as [VariantKey, ...VariantKey[]])
    .optional()
    .catch(undefined),
  // The Ledger's other states: `?state=loading` and `?state=empty`.
  state: z.enum(["loading", "empty"]).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/notifications",
)({
  // Channels and the default destination are live operational config, not an
  // as-code resource a preview branch overlays, so the preview banner would be
  // misleading here.
  staticData: { breadcrumb: "Notifications", hidePreviewFrame: true },
  head: () => ({ meta: [{ title: "Everr - Alert notifications" }] }),
  validateSearch: NotificationsSearchSchema,
  component: AlertingNotificationsPage,
});

function AlertingNotificationsPage() {
  const { variant = "ledger", state } = Route.useSearch();
  const now = Date.now();
  const ledgerData =
    state === "loading" ? null : state === "empty" ? LEDGER_EMPTY : LEDGER_DATA;
  return (
    <div className="pb-16">
      {variant === "ledger" && <VariantLedger data={ledgerData} now={now} />}
      {variant === "map" && <VariantMap now={now} />}
      {variant === "matrix" && <VariantMatrix now={now} />}
      <PrototypeSwitcher
        variants={VARIANTS}
        current={variant}
        note="synthetic data"
      />
    </div>
  );
}
