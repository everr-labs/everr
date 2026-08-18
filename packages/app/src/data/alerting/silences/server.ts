import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { AlertingSilenceInputSchema } from "../schema";
import { alertingMutationScope, alertingOrganizationId } from "../session";
import * as silences from "./repository";

export const listAlertingSilences = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  silences.listSilences(alertingOrganizationId(session)),
);

export const createAlertingSilence = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(AlertingSilenceInputSchema)
  .handler(({ data, context: { session } }) =>
    silences.createSilence(alertingMutationScope(session), data),
  );

export const expireAlertingSilence = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(({ data: { id }, context: { session } }) =>
    silences.expireSilence(alertingMutationScope(session), id),
  );
