import { copyFile } from "node:fs/promises";
import { $ } from "zx";
import {
  installCliBinary,
  prepareCliEmbeddedAssets,
  publishCliArtifact,
  resolveCliBuild,
} from "./build-support.ts";
import { withBuildTelemetry } from "./build-telemetry.ts";

const args = process.argv.slice(2);

if (args.length < 1 || args.length > 2) {
  console.error("Usage: build-cli.ts <debug|release> [--install]");
  process.exit(1);
}

const [mode, flag] = args;
let installBin = false;

if (flag === "--install") {
  installBin = true;
} else if (flag !== undefined) {
  console.error(`Unsupported flag: ${flag}`);
  process.exit(1);
}

await withBuildTelemetry("cli build", async (telemetry) => {
  telemetry.setRootAttribute("everr.build.mode", mode);

  await telemetry.phase("build local UI", () => $`pnpm --filter @everr/local-app build`);
  const { buildArgs, builtBin } = resolveCliBuild(mode);
  const assets = await prepareCliEmbeddedAssets(mode, telemetry);

  console.log(`Building everr CLI (${mode})...`);
  await telemetry.phase(
    "build cli",
    () =>
      $({
        env: {
          ...process.env,
          EVERR_EMBEDDED_COLLECTOR_GZ: assets.collectorGz,
          EVERR_EMBEDDED_CHDB_GZ: assets.chdbGz,
          EVERR_REQUIRE_EMBEDDED_COLLECTOR: "1",
        },
      })`cargo build ${buildArgs}`,
  );

  let installSource = builtBin;

  if (mode === "release") {
    const { outputBin } = await telemetry.phase("publish cli artifact", () =>
      publishCliArtifact(builtBin),
    );
    installSource = outputBin;
  }

  if (mode === "debug") {
    installSource = builtBin.replace(/everr$/, "everr-dev");
    await copyFile(builtBin, installSource);
  }

  if (installBin) {
    await installCliBinary(installSource, mode === "debug" ? "everr-dev" : "everr");
  }

  console.log(`Run '${installBin ? (mode === "debug" ? "everr-dev" : "everr") : installSource} --help' to get started.`);
});
