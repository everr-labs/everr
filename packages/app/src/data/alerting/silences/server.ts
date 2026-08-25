import { z } from "zod";

const SILENCES_PAGE_SIZE = 100;

import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { AlertingSilenceIdSchema, AlertingSilenceInputSchema } from "../schema";
import { alertingMutationScope, alertingOrganizationId } from "../session";
import * as silences from "./repository";

export const listAlertingSilences = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  // The page is fixed here: this route has no paging controls yet, so it shows
  // the newest silences and no more. Paging the panel is its own change.
  silences.listSilences(alertingOrganizationId(session), {
    limit: SILENCES_PAGE_SIZE,
    offset: 0,
  }),
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
  .inputValidator(z.object({ id: AlertingSilenceIdSchema }))
  .handler(({ data: { id }, context: { session } }) =>
    silences.expireSilence(alertingMutationScope(session), id),
  );
