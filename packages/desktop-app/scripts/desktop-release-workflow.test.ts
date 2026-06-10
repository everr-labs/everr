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
    expect(workflow).toContain('"artifact_name": "everr-desktop-release-${{ github.sha }}"');
  });

  it("packages Linux CLI binaries into the desktop release artifact", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("Build Linux CLI");
    expect(workflow).toContain("everr-linux-arm64");
    expect(workflow).toContain("everr-linux-x86_64");
    expect(workflow).toContain("everr-desktop-release-${{ github.sha }}");
    expect(workflow).toContain("target/desktop-release/everr-linux-arm64");
    expect(workflow).toContain("target/desktop-release/everr-linux-x86_64");
  });

  it("restores executable bits before merging downloaded Linux binaries", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const mergeStep = workflow.match(
      /- name: Merge Linux CLI assets\s+run: \|\n(?<body>[\s\S]*?)\n      - name:/,
    )?.groups?.body;

    expect(mergeStep).toBeDefined();
    expect(mergeStep).toMatch(
      /test -f "target\/linux-cli-release\/\$asset"\s+chmod \+x "target\/linux-cli-release\/\$asset"\s+test -x "target\/linux-cli-release\/\$asset"/,
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
