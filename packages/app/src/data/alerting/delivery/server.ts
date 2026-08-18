import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  AlertingChannelConfigSchema,
  AlertingDefaultDestinationInputSchema,
} from "../schema";
import { alertingMutationScope, alertingOrganizationId } from "../session";
import * as delivery from "./repository";

export const listAlertingChannels = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  delivery.listChannels(alertingOrganizationId(session)),
);

export const getAlertingDefaultDestination = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  delivery.listDefaultDestination(alertingOrganizationId(session)),
);

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
  .inputValidator(
    z.object({
      name: z.string().min(1),
      config: AlertingChannelConfigSchema,
    }),
  )
  .handler(({ data, context: { session } }) =>
    delivery.createChannel(alertingMutationScope(session), data),
  );

export const updateAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      name: z.string().min(1),
      newName: z.string().min(1).optional(),
      config: AlertingChannelConfigSchema,
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
  .inputValidator(z.object({ name: z.string().min(1) }))
  .handler(({ data: { name }, context: { session } }) =>
    delivery.deleteChannel(alertingMutationScope(session), name),
  );

export const testAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ config: AlertingChannelConfigSchema }))
  .handler(({ data, context: { session } }) =>
    delivery.testChannel(alertingOrganizationId(session), {
      config: data.config,
    }),
  );
