import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { platforms } from "../npm/everr.cjs";

const cliDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = path.resolve(cliDir, "../..");

export async function generateNpmPackages(
  payloadDir,
  outputDir,
  targets = Object.values(platforms),
) {
  const { version } = JSON.parse(
    await readFile(path.join(cliDir, "package.json"), "utf8"),
  );
  const common = {
    version,
    description:
      "Everr CLI for local and Cloud telemetry, CI, and resources as code",
    license: "AGPL-3.0-only",
    homepage: "https://everr.dev",
    repository: {
      type: "git",
      url: "git+https://github.com/everr-labs/everr.git",
      directory: "packages/cli",
    },
    publishConfig: { access: "public" },
  };

  async function stage(directory, manifest) {
    const destination = path.join(outputDir, directory);
    await mkdir(path.join(destination, "bin"), { recursive: true });
    await writeFile(
      path.join(destination, "package.json"),
      `${JSON.stringify({ ...common, ...manifest }, null, 2)}\n`,
    );
    await copyFile(
      path.join(repoDir, "LICENSE"),
      path.join(destination, "LICENSE"),
    );
    await copyFile(
      path.join(cliDir, "npm/README.md"),
      path.join(destination, "README.md"),
    );
    return destination;
  }

  const packages = [];
  for (const target of targets) {
    const destination = await stage(target.name.split("/")[1], {
      name: target.name,
      files: ["bin/everr"],
      os: [target.os],
      cpu: [target.cpu],
      ...(target.libc ? { libc: [target.libc] } : {}),
    });
    await copyFile(
      path.join(payloadDir, target.asset),
      path.join(destination, "bin/everr"),
    );
    await chmod(path.join(destination, "bin/everr"), 0o755);
    packages.push(destination);
  }

  const launcher = await stage("cli", {
    name: "@everr/cli",
    files: ["bin/everr.cjs"],
    bin: { everr: "bin/everr.cjs" },
    engines: { node: ">=20" },
    os: ["darwin", "linux"],
    cpu: ["arm64", "x64"],
    optionalDependencies: Object.fromEntries(
      Object.values(platforms).map(({ name }) => [name, version]),
    ),
  });
  await copyFile(
    path.join(cliDir, "npm/everr.cjs"),
    path.join(launcher, "bin/everr.cjs"),
  );
  await chmod(path.join(launcher, "bin/everr.cjs"), 0o755);
  packages.push(launcher);
  return packages;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [payloadDir, outputDir] = process.argv.slice(2);
  if (!payloadDir || !outputDir || process.argv.length !== 4) {
    throw new Error(
      "Usage: npm-packages.mjs <payload-directory> <output-directory>",
    );
  }
  for (const directory of await generateNpmPackages(payloadDir, outputDir))
    console.log(directory);
}
