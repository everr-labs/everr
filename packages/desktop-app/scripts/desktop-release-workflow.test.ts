import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflowPath = path.join(repoDir, ".github/workflows/deploy-desktop-app.yml");

describe("desktop release workflow", () => {
  it("notifies the deploy repository after uploading the signed release artifact", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("name: Deploy Desktop App");
    expect(workflow).toContain("event-type: desktop-app-release");
    expect(workflow).toContain(
      '"artifact_name": "${{ needs.release-gate.outputs.artifact_name }}"',
    );
  });

  it("runs from main pushes and not manual dispatch", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("push:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("packages/desktop-app/package.json");
    expect(workflow).not.toContain("workflow_dispatch");
  });

  it("gates releases on a consumed desktop app changeset", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("release-gate:");
    expect(workflow).toContain("node packages/desktop-app/scripts/desktop-release-gate.ts");
    expect(workflow).toContain("if: needs.release-gate.outputs.should_release == 'true'");
    expect(workflow).toContain(
      "name: everr-desktop-release-${{ needs.release-gate.outputs.version }}",
    );
  });

  it("assesses the DMG with the primary-signature Gatekeeper context", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain(
      'spctl --assess --type open --context context:primary-signature --verbose "$dmg_path"',
    );
  });

  it("requires and passes the desktop telemetry ingest key for release builds", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("EVERR_INGEST_KEY: ${{ secrets.EVERR_INGEST_KEY }}");
    expect(workflow).toContain("EVERR_INGEST_KEY \\");
    expect(workflow).toContain("pnpm --dir packages/desktop-app build:desktop:ci");
  });
});
