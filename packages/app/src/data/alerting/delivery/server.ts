/**
 * The Notifications page's server functions: one read that builds the whole
 * page, and the writes that change channels and the default destination.
 */
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { loadRules } from "@/data/alerting/triage/rules";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  AlertingChannelConfigInputSchema,
  AlertingChannelInputSchema,
  AlertingChannelNameSchema,
  AlertingChannelTestInputSchema,
  AlertingDefaultDestinationInputSchema,
} from "../schema";
import { alertingMutationScope } from "../session";
import { assembleNotifications } from "./assemble";
import { loadDeliveryRecords } from "./record";
import * as delivery from "./repository";
import type { AlertNotificationsData } from "./view";

export const getAlertNotifications = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data, context }): Promise<AlertNotificationsData> => {
    const organizationId = context.session.session.activeOrganizationId;
    const window = resolveTimeRange(data);
    const [channels, destination, rules, records] = await Promise.all([
      delivery.listChannels(organizationId),
      delivery.listDefaultDestination(organizationId),
      loadRules(organizationId),
      // The one ClickHouse read in the set, so the one that overlaps the
      // three PostgreSQL ones.
      loadDeliveryRecords(context.clickhouse.query, window),
    ]);
    return assembleNotifications({ channels, destination, rules, records });
  });

export const setAlertingDefaultDestination = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(AlertingDefaultDestinationInputSchema)
  .handler(({ data, context: { session } }) =>
    delivery.setDefaultDestination(alertingMutationScope(session), data),
  );

export const createAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(AlertingChannelInputSchema)
  .handler(({ data, context: { session } }) =>
    delivery.createChannel(alertingMutationScope(session), data),
  );

export const updateAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      name: AlertingChannelNameSchema,
      newName: AlertingChannelNameSchema.optional(),
      // Optional: a rename alone leaves the stored secret as it is.
      config: AlertingChannelConfigInputSchema.optional(),
    }),
  )
  .handler(({ data, context: { session } }) =>
    delivery.updateChannel(alertingMutationScope(session), data.name, {
      name: data.newName,
      config: data.config,
    }),
  );

export const deleteAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ name: AlertingChannelNameSchema }))
  .handler(({ data: { name }, context: { session } }) =>
    delivery.deleteChannel(alertingMutationScope(session), name),
  );

export const testAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(AlertingChannelTestInputSchema)
  .handler(({ data, context: { session } }) =>
    delivery.testChannel(session.session.activeOrganizationId, data),
  );
