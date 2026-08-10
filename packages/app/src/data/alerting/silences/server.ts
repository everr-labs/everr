import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { AlertingSilenceInputSchema } from "../schema";
import { alertingOrganizationId } from "../session";
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
    silences.createSilence(alertingOrganizationId(session), data),
  );

export const expireAlertingSilence = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    silences.expireSilence(alertingOrganizationId(session), id),
  );
