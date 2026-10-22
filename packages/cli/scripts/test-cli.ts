import { $ } from "zx";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareCliEmbeddedAssets } from "./build-support.ts";
import { withBuildTelemetry } from "./build-telemetry.ts";
import { embeddedAssets, embeddedBuildEnv, resolveCliBuild } from "./cli-build.ts";

const args = process.argv.slice(2);
const prepared = args[0] === "--prepared";
if (prepared) args.shift();

await withBuildTelemetry("cli tests", async (telemetry) => {
  let assets = embeddedAssets;
  if (prepared) {
    // CI builds the release first, so tests can use the same embedded assets.
    await Promise.all([
      ...Object.values(assets),
      resolve(import.meta.dirname, "../../local-app/dist/index.html"),
    ].map((file) => access(file)));
  } else {
    await telemetry.phase("build local UI", () => $`pnpm --filter @everr/local-app build`);
    assets = await prepareCliEmbeddedAssets("debug", telemetry);
  }
  const { buildArgs } = resolveCliBuild("debug");
  await telemetry.phase("test cli", () =>
    $({ env: embeddedBuildEnv(assets), stdio: "inherit" })`cargo test ${buildArgs} ${args}`,
  );
});
