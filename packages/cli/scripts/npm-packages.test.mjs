import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { platforms } from "../npm/everr.cjs";
import { generateNpmPackages } from "./npm-packages.mjs";
import { publishNpmPackages } from "./publish-npm.mjs";

const host = platforms[`${process.platform}-${process.arch}`];
let root, packages, tarballs, env;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    timeout: 30_000,
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result;
}

async function pack(directory) {
  const [manifest] = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json"], { cwd: directory })
      .stdout,
  );
  return { archive: path.join(directory, manifest.filename), manifest };
}

async function install(archives, scope = "project") {
  const destination = await mkdtemp(path.join(root, `${scope}-`));
  const args = [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ];
  if (scope === "global") args.push("--global", "--prefix", destination);
  else
    await writeFile(path.join(destination, "package.json"), '{"private":true}');
  run("npm", [...args, ...archives], { cwd: destination });
  return path.join(
    destination,
    scope === "global" ? "bin/everr" : "node_modules/.bin/everr",
  );
}

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "everr-npm-"));
  env = {
    ...process.env,
    npm_config_cache: path.join(root, "cache"),
    npm_config_userconfig: path.join(root, "npmrc"),
    npm_config_globalconfig: path.join(root, "global-npmrc"),
    npm_config_update_notifier: "false",
  };
  await writeFile(env.npm_config_userconfig, "");
  await writeFile(env.npm_config_globalconfig, "");
  const payload = path.join(root, "payload");
  await mkdir(payload);
  const binary = `#!/usr/bin/env node
const [command, ...args] = process.argv.slice(2);
if (command === "exit") process.exit(Number(args[0]));
else if (command === "signal") process.kill(process.pid, args[0]);
else if (command === "wait") {
  process.on("SIGTERM", () => process.exit(42));
  console.log("ready");
  setInterval(() => {}, 1000);
} else if (command === "stdin") process.stdin.pipe(process.stdout);
else console.log(JSON.stringify(args));
`;
  for (const { asset } of Object.values(platforms))
    await writeFile(path.join(payload, asset), binary);
  packages = await generateNpmPackages(payload, path.join(root, "packages"));
  const platformPackage = packages.find((dir) =>
    dir.endsWith(host.name.split("/")[1]),
  );
  tarballs = await Promise.all([platformPackage, packages.at(-1)].map(pack));
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("packed launcher preserves terminal input, arguments, exit codes, and signals", {
  timeout: 15_000,
}, async (context) => {
  for (const [index, executable] of ["everr", "everr.cjs"].entries()) {
    const contents = tarballs[index].manifest.files
      .map(({ path }) => path)
      .sort();
    assert.deepEqual(contents, [
      "LICENSE",
      "README.md",
      `bin/${executable}`,
      "package.json",
    ]);
  }
  const executable = await install(tarballs.map(({ archive }) => archive));
  const args = ["two words", "$(untouched)", "--flag"];
  assert.deepEqual(JSON.parse(run(executable, ["args", ...args]).stdout), args);
  assert.equal(
    run(executable, ["stdin"], { input: "terminal input\n" }).stdout,
    "terminal input\n",
  );
  assert.equal(spawnSync(executable, ["exit", "17"], { env }).status, 17);
  assert.equal(
    spawnSync(executable, ["signal", "SIGINT"], { env }).signal,
    "SIGINT",
  );
  const child = spawn(executable, ["wait"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => child.kill("SIGKILL"));
  const closed = once(child, "close");
  await once(child.stdout, "data");
  child.kill("SIGTERM");
  assert.deepEqual(await closed, [42, null]);
});

test("publisher retries a partial release without publishing the launcher early", async () => {
  const published = new Set(["cli-darwin-arm64"]);
  const attempts = [];
  let fail = true;
  const run = (_command, args, options) => {
    if (args[0] === "view") {
      const name = args[1].split("/")[1].split("@")[0];
      return published.has(name)
        ? { status: 0, stdout: JSON.stringify(tarballs[1].manifest.version) }
        : { status: 1, stderr: "E404" };
    }
    const name = path.basename(options.cwd);
    attempts.push(name);
    if (name === "cli-linux-x64" && fail) return { status: 1 };
    published.add(name);
    return { status: 0 };
  };
  await assert.rejects(
    publishNpmPackages(path.join(root, "packages"), { run }),
    /Publishing.*failed/,
  );
  assert.deepEqual(attempts, ["cli-linux-arm64", "cli-linux-x64"]);
  fail = false;
  await publishNpmPackages(path.join(root, "packages"), { run });
  assert.deepEqual(attempts, [
    "cli-linux-arm64",
    "cli-linux-x64",
    "cli-linux-x64",
    "cli",
  ]);
});

test("packaged Rust binary supports project, global, and temporary npm installations", {
  skip: !process.env.EVERR_NPM_SMOKE_BINARY,
  timeout: 180_000,
}, async () => {
  const payload = path.join(root, "native-payload");
  await mkdir(payload);
  await copyFile(
    path.resolve(process.env.EVERR_NPM_SMOKE_BINARY),
    path.join(payload, host.asset),
  );
  const nativePackages = await generateNpmPackages(
    payload,
    path.join(root, "native-packages"),
    [host],
  );
  const nativeTarballs = await Promise.all(nativePackages.map(pack));
  const archives = nativeTarballs.map(({ archive }) => archive);
  for (const scope of ["project", "global"]) {
    const executable = await install(archives, scope);
    assert.match(run(executable, ["--help"]).stdout, /Usage:/);
    assert.ok(
      run(executable, ["--version"]).stdout.includes(
        nativeTarballs[1].manifest.version,
      ),
    );
    const expected =
      scope === "global"
        ? "npm install --global @everr/cli@latest"
        : "npm install @everr/cli@latest";
    assert.ok(run(executable, ["upgrade"]).stdout.includes(expected));
  }
  const args = [
    "exec",
    "--offline",
    "--yes",
    "--ignore-scripts",
    ...archives.map((archive) => `--package=${archive}`),
    "--",
    "everr",
    "upgrade",
  ];
  assert.match(
    run("npm", args, { cwd: root }).stdout,
    /npx @everr\/cli@latest/,
  );
});
