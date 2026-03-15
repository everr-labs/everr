import { $ } from "zx";
import { loadBuildEnvFile } from "./build-support.ts";
import { copyReleaseArtifact } from "./copy-release-artifact.ts";

loadBuildEnvFile();

await $`pnpm tauri build ${process.argv.slice(2)}`;
await copyReleaseArtifact();
