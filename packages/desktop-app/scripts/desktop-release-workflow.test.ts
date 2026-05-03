import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflowPath = path.join(repoDir, ".github/workflows/build-signed-desktop-release.yml");

describe("desktop release workflow", () => {
  it("assesses the DMG with the primary-signature Gatekeeper context", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain(
      'spctl --assess --type open --context context:primary-signature --verbose "$dmg_path"',
    );
  });
});
