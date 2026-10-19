import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { auth } from "#app/identity/server.ts";
import { createPartiallyAuthenticatedServerFn } from "#app/lib/serverFn.ts";

const DeleteCurrentUserAccountInputSchema = z.object({
  confirmation: z.literal("DELETE"),
  deleteOrganization: z.boolean().optional(),
});

export const deleteCurrentUserAccount = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(DeleteCurrentUserAccountInputSchema)
  .handler(({ data }) =>
    auth.deleteAccount({
      headers: getRequestHeaders(),
      deleteOrganization: data.deleteOrganization,
    }),
  );
