// Development only: the self-hosted seed entry point for `pnpm dev`.
import { runDevSeed } from "../../scripts/dev-seed.ts";

await runDevSeed("app", async ({ db, email, password }) => {
  const { getInstallation, setupWorkspace } = await import("./installation.server.ts");
  if (await getInstallation(db)) {
    throw new Error(
      `This App workspace has no owner or admin with ${email}. Set EVERR_DEV_EMAIL to an existing owner's email.`,
    );
  }
  await setupWorkspace({ workspaceName: "Everr Dev", name: "Everr Dev", email, password }, db);
});
