import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoDir } from "./build-support";

const workflowPath = path.join(repoDir, ".github/workflows/build-everr-cli.yml");

describe("CLI release workflow", () => {
  it("builds Linux arm64 and x86_64 artifacts", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("everr-linux-arm64");
    expect(workflow).toContain("everr-linux-x86_64");
    expect(workflow).toContain("blacksmith-2vcpu-ubuntu-2404-arm");
    expect(workflow).toContain("ubuntu-24.04");
  });

  it("uploads and attests the merged Linux CLI release payload", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("everr-cli-linux-release-${{ github.sha }}");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("actions/attest@v4");
    expect(workflow).toContain("subject-checksums: target/cli-release/SHA256SUMS");
  });

  it("restores executable bits before validating downloaded Linux binaries", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const validateStep = workflow.match(
      /- name: Validate release payload\s+run: \|\n(?<body>[\s\S]*?)\n      - name:/,
    )?.groups?.body;

    expect(validateStep).toBeDefined();
    expect(validateStep).toMatch(
      /test -f "\$asset"\s+chmod \+x "\$asset"\s+test -x "\$asset"\s+test -f "\$asset\.sha256"\s+sha256sum -c "\$asset\.sha256"/,
    );
  });

  it("dispatches the deploy repository with the Linux CLI artifact name", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("event-type: cli-linux-release");
    expect(workflow).toContain("repository: everr-labs/everr-deploy");
    expect(workflow).toContain('"release_kind": "cli-linux"');
    expect(workflow).toContain('"artifact_name": "everr-cli-linux-release-${{ github.sha }}"');
  });
});
