import { events } from "#app/server/events/runtime.ts";
import { createServerFn } from "@tanstack/react-start";
import { db } from "#app/db/client.ts";
import {
  InstallationSetupError,
  SetupWorkspaceSchema,
  setupWorkspace,
} from "./installation.server";

export const completeSetup = createServerFn({ method: "POST" })
  .validator(SetupWorkspaceSchema)
  .handler(async ({ data }) => {
    try {
      return await setupWorkspace(data, db, events);
    } catch (error) {
      if (error instanceof InstallationSetupError) throw error;
      // oxlint-disable-next-line preserve-caught-error -- Preserve the existing public setup error shape.
      throw new Error(
        "Setup could not be completed. Check the server configuration and try again.",
      );
    }
  });
