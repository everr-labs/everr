import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  AlertingChannelConfigSchema,
  AlertingInhibitionInputSchema,
  AlertingRouteInputSchema,
} from "../schema";
import { alertingMutationScope, alertingOrganizationId } from "../session";
import * as delivery from "./repository";

export const listAlertingChannels = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  delivery.listChannels(alertingOrganizationId(session)),
);

export const listAlertingReceivers = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  delivery.listReceivers(alertingOrganizationId(session)),
);

export const listAlertingRoutes = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  delivery.listRoutes(alertingOrganizationId(session)),
);

export const listAlertingInhibitions = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  delivery.listInhibitions(alertingOrganizationId(session)),
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

export const createAlertingReceiver = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      name: z.string().min(1),
      channels: z.array(z.string().min(1)).min(1),
    }),
  )
  .handler(({ data, context: { session } }) =>
    delivery.createReceiver(alertingMutationScope(session), data),
  );

export const updateAlertingReceiver = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      name: z.string().min(1),
      newName: z.string().min(1).optional(),
      channels: z.array(z.string().min(1)).min(1),
    }),
  )
  .handler(({ data, context: { session } }) =>
    delivery.updateReceiver(alertingMutationScope(session), data.name, {
      name: data.newName,
      channels: data.channels,
    }),
  );

export const deleteAlertingReceiver = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ name: z.string().min(1) }))
  .handler(({ data: { name }, context: { session } }) =>
    delivery.deleteReceiver(alertingMutationScope(session), name),
  );

export const createAlertingRoute = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(AlertingRouteInputSchema)
  .handler(({ data, context: { session } }) =>
    delivery.createRoute(alertingMutationScope(session), data),
  );

export const updateAlertingRoute = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string(), input: AlertingRouteInputSchema }))
  .handler(({ data: { id, input }, context: { session } }) =>
    delivery.updateRoute(alertingMutationScope(session), id, input),
  );

export const deleteAlertingRoute = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    delivery.deleteRoute(alertingMutationScope(session), id),
  );

export const createAlertingInhibition = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(AlertingInhibitionInputSchema)
  .handler(({ data, context: { session } }) =>
    delivery.createInhibition(alertingMutationScope(session), data),
  );

export const deleteAlertingInhibition = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    delivery.deleteInhibition(alertingMutationScope(session), id),
  );
