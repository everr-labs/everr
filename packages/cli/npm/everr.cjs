#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const platforms = {
  "darwin-arm64": {
    name: "@everr/cli-darwin-arm64",
    asset: "everr",
    os: "darwin",
    cpu: "arm64",
  },
  "linux-arm64": {
    name: "@everr/cli-linux-arm64",
    asset: "everr-linux-arm64",
    os: "linux",
    cpu: "arm64",
    libc: "glibc",
  },
  "linux-x64": {
    name: "@everr/cli-linux-x64",
    asset: "everr-linux-x86_64",
    os: "linux",
    cpu: "x64",
    libc: "glibc",
  },
};

function installScope(packageDir) {
  const parts = packageDir.split(path.sep);
  if (parts.includes("_npx")) return "temporary";
  if (
    parts.some(
      (part, index) => part === "lib" && parts[index + 1] === "node_modules",
    )
  )
    return "global";
  return "project";
}

function resolveBinary(platform = process.platform, arch = process.arch) {
  const target = platforms[`${platform}-${arch}`];
  if (!target) {
    throw new Error(
      `Everr does not support ${platform}-${arch}. Supported platforms: ${Object.keys(platforms).join(", ")}.`,
    );
  }
  if (
    platform === "linux" &&
    !process.report.getReport().header.glibcVersionRuntime
  ) {
    throw new Error(
      "Everr requires glibc on Linux. musl-based distributions such as Alpine are not supported.",
    );
  }

  const manifestPath = require.resolve(`${target.name}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const launcher = JSON.parse(
    readFileSync(path.join(__dirname, "../package.json"), "utf8"),
  );
  if (manifest.version !== launcher.version) {
    throw new Error(
      `Expected ${target.name}@${launcher.version}, found ${manifest.version}. Reinstall @everr/cli with optional dependencies enabled.`,
    );
  }
  return path.join(path.dirname(manifestPath), "bin/everr");
}

function run() {
  let binary;
  try {
    binary = resolveBinary();
  } catch (error) {
    const message =
      error.code === "MODULE_NOT_FOUND"
        ? "The Everr binary package is missing. Reinstall @everr/cli with optional dependencies enabled (npm install --include=optional)."
        : error.message;
    console.error(message);
    process.exitCode = 1;
    return;
  }

  const child = spawn(binary, process.argv.slice(2), {
    stdio: "inherit",
    env: {
      ...process.env,
      EVERR_INSTALL_SOURCE: "npm",
      EVERR_NPM_INSTALL_SCOPE: installScope(path.resolve(__dirname, "..")),
    },
  });
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  function cleanup() {
    for (const [signal, handler] of handlers)
      process.removeListener(signal, handler);
  }
  let failed = false;
  child.on("error", (error) => {
    failed = true;
    cleanup();
    console.error(`Could not start Everr: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    cleanup();
    if (failed) return;
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

module.exports = { platforms };
if (require.main === module) run();
