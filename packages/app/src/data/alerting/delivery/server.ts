/**
 * The Notifications page's server functions: one read that builds the whole
 * page, and the writes that change channels and the default destination.
 */
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { loadRules } from "#app/data/alerting/rules/read.ts";
import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";
import {
  AlertingChannelConfigInputSchema,
  AlertingChannelInputSchema,
  AlertingChannelNameSchema,
  AlertingChannelTestInputSchema,
  AlertingDefaultDestinationInputSchema,
} from "../schema";
import { alertingMutationScope } from "../session";
import { assembleNotifications } from "./assemble";
import { loadUndeliveredRecords } from "./record";
import * as delivery from "./repository";
import type { AlertNotificationsData } from "./view";

export const getAlertNotifications = createAuthenticatedServerFn({
  method: "GET",
})
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data, context }): Promise<AlertNotificationsData> => {
    const organizationId = context.session.session.activeOrganizationId;
    const window = resolveTimeRange(data);
    const [channels, destination, rules, undelivered] = await Promise.all([
      delivery.listChannels(organizationId),
      delivery.listDefaultDestination(organizationId),
      loadRules(organizationId),
      // The one ClickHouse read in the set, so the one that overlaps the
      // three PostgreSQL ones.
      loadUndeliveredRecords(context.clickhouse.query, window),
    ]);
    return assembleNotifications({ channels, destination, rules, undelivered });
  });

export const setAlertingDefaultDestination = createAuthenticatedServerFn({
  method: "POST",
})
  .validator(AlertingDefaultDestinationInputSchema)
  .handler(({ data, context: { session } }) =>
    delivery.setDefaultDestination(alertingMutationScope(session), data),
  );

export const createAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .validator(AlertingChannelInputSchema)
  .handler(({ data, context: { session } }) =>
    delivery.createChannel(alertingMutationScope(session), data),
  );

export const updateAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .validator(
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
  .validator(z.object({ name: AlertingChannelNameSchema }))
  .handler(({ data: { name }, context: { session } }) =>
    delivery.deleteChannel(alertingMutationScope(session), name),
  );

export const testAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .validator(AlertingChannelTestInputSchema)
  .handler(({ data, context: { session } }) =>
    delivery.testChannel(session.session.activeOrganizationId, data),
  );
