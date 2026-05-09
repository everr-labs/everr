import { desktopReleaseDir } from "./build-support.ts";
import {
  assertCliReleaseArtifactsPresent,
  refreshReleaseFilesIndex,
} from "./copy-release-artifact.ts";

await assertCliReleaseArtifactsPresent(desktopReleaseDir);
await refreshReleaseFilesIndex(desktopReleaseDir);

console.log(`Finalized desktop release artifacts in ${desktopReleaseDir}`);
