import { createPartiallyAuthenticatedServerFn } from "@everr/app/lib/serverFn";
import { CreateOrganizationInputSchema } from "../common/organization-name";
import { organizationCommands } from "../organizations/commands.server";

export const getOrganizationCreationOptions = createPartiallyAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => organizationCommands.creationOptions(session.user.id));

export const createOrganization = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateOrganizationInputSchema)
  .handler(({ data, context: { session } }) =>
    organizationCommands.create({ actorId: session.user.id, input: data }),
  );
