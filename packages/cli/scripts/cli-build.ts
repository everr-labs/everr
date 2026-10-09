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

export function resolveCliBuild(mode: string) {
  if (mode !== "debug" && mode !== "release") throw new Error(`Unsupported mode: ${mode}`);
  const builtBin = path.join(repoDir, "target", mode, "everr");
  return {
    buildArgs: [...(mode === "release" ? ["--release"] : []), "--manifest-path", path.join(cliDir, "Cargo.toml")],
    builtBin,
    outputBin: mode === "debug" ? `${builtBin}-dev` : builtBin,
  };
}

export function embeddedBuildEnv(assets = embeddedAssets): NodeJS.ProcessEnv {
  return {
    ...process.env,
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
