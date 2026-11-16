import { $ } from "zx";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { withBuildTelemetry } from "./build-telemetry.ts";
import { goBuildEnv } from "./cli-build.ts";
import { stageGoAssets } from "./stage-go-assets.ts";

const cliDir = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const prepared = args[0] === "--prepared";
if (prepared) args.shift();

await withBuildTelemetry("cli tests", async (telemetry) => {
  if (prepared) {
    // CI builds the release first, so tests reuse the assets it staged.
    await access(new URL("../internal/assets/localui/index.html", import.meta.url));
    await access(new URL("../internal/assets/chdb/libchdb.so.zst", import.meta.url));
  } else {
    await telemetry.phase("build local UI", () => $`pnpm --filter @everr/local-app build`);
    await telemetry.phase("stage embedded assets", () => stageGoAssets({ requireUi: true }));
  }
  await telemetry.phase(
    "test cli",
    () => $({ env: goBuildEnv(), cwd: cliDir, stdio: "inherit" })`go test ./... ${args}`,
  );
});
