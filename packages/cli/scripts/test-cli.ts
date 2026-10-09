import { $ } from "zx";
import { prepareCliEmbeddedAssets } from "./build-support.ts";
import { withBuildTelemetry } from "./build-telemetry.ts";
import { embeddedBuildEnv, resolveCliBuild } from "./cli-build.ts";

await withBuildTelemetry("cli tests", async (telemetry) => {
  await telemetry.phase("build local UI", () => $`pnpm --filter @everr/local-app build`);
  const assets = await prepareCliEmbeddedAssets("debug", telemetry);
  const { buildArgs } = resolveCliBuild("debug");
  await telemetry.phase("test cli", () =>
    $({ env: embeddedBuildEnv(assets), stdio: "inherit" })`cargo test ${buildArgs} ${process.argv.slice(2)}`,
  );
});
