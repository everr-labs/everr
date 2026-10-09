import { $ } from "zx";
import {
  installCliBinary,
  prepareCliEmbeddedAssets,
  publishCliArtifact,
} from "./build-support.ts";
import { compileCli } from "./cli-build.ts";
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
  const assets = await prepareCliEmbeddedAssets(mode, telemetry);

  console.log(`Building everr CLI (${mode})...`);
  const builtBin = await telemetry.phase("build cli", () =>
    compileCli(mode, assets, (command, args, env) => $({ env })`${command} ${args}`),
  );
  let installSource = builtBin;

  if (mode === "release") {
    const { outputBin } = await telemetry.phase("publish cli artifact", () =>
      publishCliArtifact(builtBin),
    );
    installSource = outputBin;
  }

  if (installBin) {
    await installCliBinary(installSource, mode === "debug" ? "everr-dev" : "everr");
  }

  console.log(`Run '${installBin ? (mode === "debug" ? "everr-dev" : "everr") : installSource} --help' to get started.`);
});
