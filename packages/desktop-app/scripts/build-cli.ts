import { $ } from "zx";
import {
  installCliBinary,
  prepareCliEmbeddedAssets,
  publishCliArtifact,
  resolveCliBuild,
} from "./build-support.ts";

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

const { buildArgs, builtBin } = resolveCliBuild(mode);
const assets = await prepareCliEmbeddedAssets(mode);

console.log(`Building everr CLI (${mode})...`);
await $({
  env: {
    ...process.env,
    EVERR_EMBEDDED_COLLECTOR_GZ: assets.collectorGz,
    EVERR_EMBEDDED_CHDB_GZ: assets.chdbGz,
    EVERR_REQUIRE_EMBEDDED_COLLECTOR: "1",
  },
})`cargo build ${buildArgs}`;

let installSource = builtBin;

if (mode === "release") {
  const { outputBin } = await publishCliArtifact(builtBin);
  installSource = outputBin;
}

if (installBin || mode === "debug") {
  await installCliBinary(installSource, mode === "debug" ? "everr-dev" : "everr");
}

console.log(`Run '${mode === "debug" ? "everr-dev" : "everr"} --help' to get started.`);
