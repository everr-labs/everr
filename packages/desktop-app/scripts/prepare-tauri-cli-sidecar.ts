import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { $ } from "zx";
import {
  desktopReleaseDir,
  prepareCliEmbeddedAssets,
  publishCliArtifact,
  resolveCliBuild,
  repoDir,
  signBinaryIfNeeded,
} from "./build-support.ts";
import { withBuildTelemetry } from "./build-telemetry.ts";

const args = process.argv.slice(2);

if (args.length !== 1) {
  console.error("Usage: prepare-tauri-cli-sidecar.ts <debug|release>");
  process.exit(1);
}

const [mode] = args;

await withBuildTelemetry("cli sidecar build", async (telemetry) => {
  telemetry.setRootAttribute("everr.build.mode", mode);

  const { buildArgs, builtBin } = resolveCliBuild(mode);
  const assets = await prepareCliEmbeddedAssets(mode, telemetry);
  const sourceBin = builtBin;
  const resourceDir = path.join(repoDir, "target", "desktop-resources");
  const destBin = path.join(resourceDir, "everr");

  console.log(`Building bundled Everr CLI (${mode})...`);
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

  await mkdir(resourceDir, { recursive: true });
  await rm(path.join(resourceDir, "libchdb.so"), { force: true });
  await copyFile(sourceBin, destBin);
  await chmod(destBin, 0o755);

  if (mode === "release") {
    await telemetry.phase("sign cli binary", () => signBinaryIfNeeded(destBin));
    await telemetry.phase("publish cli artifact", () =>
      publishCliArtifact(sourceBin, { outputDir: desktopReleaseDir }),
    );
  }

  console.log(`Prepared bundled CLI resource at ${destBin}`);
});
