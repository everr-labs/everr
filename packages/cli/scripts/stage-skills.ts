import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Kept apart from stage-go-assets.ts so the local-app dev loop can restage
// skills without importing the chDB build helpers.
const cliDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = path.resolve(cliDir, "../..");

/** Empties dir, keeping the .gitkeep that holds it in git. */
export async function resetDir(dir: string) {
  await mkdir(dir, { recursive: true });
  for (const entry of await readdir(dir)) {
    if (entry !== ".gitkeep") await rm(path.join(dir, entry), { recursive: true, force: true });
  }
}

/** Copies the repository's skills/ into the CLI's embedded assets. */
export async function stageSkills() {
  const skillsDir = path.join(cliDir, "internal/assets/skills");
  await resetDir(skillsDir);
  await cp(path.join(repoDir, "skills"), skillsDir, { recursive: true });
}
