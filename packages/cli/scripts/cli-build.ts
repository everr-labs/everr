import { copyFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = path.resolve(cliDir, "../..");
const assetsDir = path.join(repoDir, "target/cli-embedded-assets");

export const embeddedAssets = {
  collectorGz: path.join(assetsDir, "everr-local-collector.gz"),
  chdbGz: path.join(assetsDir, "libchdb.so.gz"),
};

export function resolveCliBuild(mode: string, env: NodeJS.ProcessEnv = process.env) {
  if (mode !== "debug" && mode !== "release") throw new Error(`Unsupported mode: ${mode}`);
  if (mode === "release" && env.EVERR_REQUIRE_INTERNAL_TELEMETRY === "1" &&
    !env.EVERR_INTERNAL_TELEMETRY_INGEST_KEY?.trim()) {
    throw new Error("Official CLI releases require EVERR_INTERNAL_TELEMETRY_INGEST_KEY");
  }
  const builtBin = path.join(repoDir, "target", mode, "everr");
  return {
    buildArgs: [...(mode === "release" ? ["--release"] : []), "--manifest-path", path.join(cliDir, "Cargo.toml")],
    builtBin,
    outputBin: mode === "debug" ? `${builtBin}-dev` : builtBin,
  };
}

export function embeddedBuildEnv(assets = embeddedAssets): NodeJS.ProcessEnv {
  // Build-script telemetry retains the generic key in the parent process;
  // only the dedicated product key is passed to the Rust compiler.
  const { EVERR_INGEST_KEY: _buildTelemetryKey, ...env } = process.env;
  return {
    ...env,
    EVERR_INTERNAL_TELEMETRY_INGEST_KEY: process.env.EVERR_INTERNAL_TELEMETRY_INGEST_KEY,
    EVERR_EMBEDDED_COLLECTOR_GZ: assets.collectorGz,
    EVERR_EMBEDDED_CHDB_GZ: assets.chdbGz,
    EVERR_REQUIRE_EMBEDDED_COLLECTOR: "1",
  };
}

export async function compileCli(
  mode: string,
  assets: typeof embeddedAssets,
  run: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<unknown>,
) {
  const { buildArgs, builtBin, outputBin } = resolveCliBuild(mode);
  await run("cargo", ["build", ...buildArgs], embeddedBuildEnv(assets));
  if (outputBin !== builtBin) {
    const temporary = `${outputBin}.${process.pid}.tmp`;
    await copyFile(builtBin, temporary);
    await rename(temporary, outputBin);
  }
  return outputBin;
}
