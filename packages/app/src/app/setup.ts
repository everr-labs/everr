import { createServerFn } from "@tanstack/react-start";
import { appEnv } from "./env";
import {
  InstallationSetupError,
  SetupWorkspaceSchema,
  setupWorkspace,
} from "./installation.server";

export const completeSetup = createServerFn({ method: "POST" })
  .inputValidator(SetupWorkspaceSchema)
  .handler(async ({ data }) => {
    try {
      return await setupWorkspace(data, appEnv.EVERR_SETUP_TOKEN);
    } catch (error) {
      if (error instanceof InstallationSetupError) throw error;
      throw new Error(
        "Setup could not be completed. Check the server configuration and try again.",
      );
    }
  });
