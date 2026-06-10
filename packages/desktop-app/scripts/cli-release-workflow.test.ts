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

  it("uploads per-architecture Linux CLI build artifacts", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("everr-cli-${{ matrix.name }}-${{ github.sha }}");
    expect(workflow).toContain("actions/upload-artifact@v4");
  });

  it("does not dispatch a separate Linux CLI release", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).not.toContain("repository: everr-labs/everr-deploy");
    expect(workflow).not.toContain("repository-dispatch");
    expect(workflow).not.toContain("cli-linux-release");
  });
});
