// @vitest-environment node

import { execFile as execFileWithCallback } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const installScript = path.join(repoDir, "packages", "docs", "public", "install.sh");
const tempDirs: string[] = [];
const execFile = promisify(execFileWithCallback);

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "everr-install-script-"));
  tempDirs.push(dir);
  return dir;
}

async function writeExecutable(filePath: string, contents: string) {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
}

async function runInstallerFor(target: { os: string; arch: string }) {
  const rootDir = await makeTempDir();
  const binDir = path.join(rootDir, "bin");
  const homeDir = path.join(rootDir, "home");
  const curlLog = path.join(rootDir, "curl.log");

  await mkdir(binDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await writeExecutable(
    path.join(binDir, "uname"),
    `#!/usr/bin/env bash
case "$1" in
  -s) printf '%s\\n' "$FAKE_UNAME_OS" ;;
  -m) printf '%s\\n' "$FAKE_UNAME_ARCH" ;;
  *) exit 1 ;;
esac
`,
  );
  await writeExecutable(
    path.join(binDir, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while (($#)); do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
printf '%s\\n' "$url" >> "$FAKE_CURL_LOG"
asset="\${url##*/}"
if [[ "$asset" == *.sha256 ]]; then
  binary="\${asset%.sha256}"
  printf '178893fed67c46f50c58cd77b698bb27649bee32019baa1e72b5142f9676e7a2  %s\\n' "$binary" > "$output"
else
  printf 'cli bytes' > "$output"
fi
`,
  );

  await execFile("bash", [installScript], {
    env: {
      ...process.env,
      FAKE_CURL_LOG: curlLog,
      FAKE_UNAME_ARCH: target.arch,
      FAKE_UNAME_OS: target.os,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });

  return {
    curlLog,
    installPath: path.join(homeDir, ".local", "bin", "everr"),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("install.sh", () => {
  it("downloads the Linux x64 CLI artifact on x86_64 Linux", async () => {
    const result = await runInstallerFor({ os: "Linux", arch: "x86_64" });

    await expect(readFile(result.curlLog, "utf8")).resolves.toBe(
      [
        "https://everr.dev/everr-app/everr-linux-x64",
        "https://everr.dev/everr-app/everr-linux-x64.sha256",
        "",
      ].join("\n"),
    );
    await expect(readFile(result.installPath, "utf8")).resolves.toBe("cli bytes");
  });

  it("downloads the Linux arm64 CLI artifact on aarch64 Linux", async () => {
    const result = await runInstallerFor({ os: "Linux", arch: "aarch64" });

    await expect(readFile(result.curlLog, "utf8")).resolves.toContain(
      "https://everr.dev/everr-app/everr-linux-arm64\n",
    );
  });

  it("downloads the macOS arm64 CLI artifact on Apple Silicon", async () => {
    const result = await runInstallerFor({ os: "Darwin", arch: "arm64" });

    await expect(readFile(result.curlLog, "utf8")).resolves.toContain(
      "https://everr.dev/everr-app/everr-macos-arm64\n",
    );
  });

  it("prints a clear error for unsupported architectures", async () => {
    await expect(
      runInstallerFor({ os: "Linux", arch: "armv7l" }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unsupported architecture"),
    });
  });
});
