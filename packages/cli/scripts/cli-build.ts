import { copyFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = path.resolve(cliDir, "../..");
const goModule = "github.com/everr-labs/everr/packages/cli";

export function resolveCliBuild(mode: string, env: NodeJS.ProcessEnv = process.env) {
  if (mode !== "debug" && mode !== "release") throw new Error(`Unsupported mode: ${mode}`);
  if (
    mode === "release" &&
    env.EVERR_REQUIRE_INTERNAL_TELEMETRY === "1" &&
    !env.EVERR_INTERNAL_TELEMETRY_INGEST_KEY?.trim()
  ) {
    throw new Error("Official CLI releases require EVERR_INTERNAL_TELEMETRY_INGEST_KEY");
  }
  const builtBin = path.join(repoDir, "target", "go", mode, "everr");
  return {
    buildArgs: goBuildArgs(mode, env, builtBin),
    builtBin,
    outputBin: mode === "debug" ? `${builtBin}-dev` : builtBin,
  };
}

function goBuildArgs(mode: string, env: NodeJS.ProcessEnv, output: string) {
  const ldflags: string[] = [];
  // Debug builds never embed the product key; they export to the local collector.
  const key = env.EVERR_INTERNAL_TELEMETRY_INGEST_KEY?.trim();
  if (mode === "release") {
    if (key) ldflags.push(`-X ${goModule}/internal/internaltelemetry.ingestKey=${key}`);
    ldflags.push("-s", "-w");
  }
  return [
    "build",
    "-trimpath",
    ...(mode === "release" ? ["-tags", "release"] : []),
    "-ldflags",
    ldflags.join(" "),
    "-o",
    output,
    "./cmd/everr",
  ];
}

export function goBuildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Build-script telemetry keeps the generic key in the parent process, and
  // the product key reaches the binary only through -ldflags.
  const {
    EVERR_INGEST_KEY: _buildTelemetryKey,
    EVERR_INTERNAL_TELEMETRY_INGEST_KEY: _productKey,
    ...rest
  } = env;
  // libchdb is loaded with purego, so the CLI needs no C toolchain.
  return { ...rest, CGO_ENABLED: "0" };
}

export async function compileCli(
  mode: string,
  run: (command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) => Promise<unknown>,
) {
  const { buildArgs, builtBin, outputBin } = resolveCliBuild(mode);
  await run("go", buildArgs, goBuildEnv(), cliDir);
  if (outputBin !== builtBin) {
    const temporary = `${outputBin}.${process.pid}.tmp`;
    await copyFile(builtBin, temporary);
    await rename(temporary, outputBin);
  }
  return outputBin;
}
