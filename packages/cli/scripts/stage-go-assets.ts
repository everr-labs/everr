import { cp, link, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chdbSigningIdentity, prepareChdbLibAt, sha256File, zstdFile } from "./build-support.ts";
import { resetDir, stageSkills } from "./stage-skills.ts";

const cliDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = path.resolve(cliDir, "../..");
const assetsDir = path.join(cliDir, "internal/assets");
const chdbCacheDir = path.join(repoDir, "target/cli-go-assets");

async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function linkOrCopy(source: string, dest: string) {
  await rm(dest, { force: true });
  try {
    await link(source, dest);
  } catch {
    await cp(source, dest);
  }
}

/**
 * Copies everything the Go CLI embeds into internal/assets, since go:embed
 * cannot read outside the module. The compressed libchdb is cached under
 * target/ because compressing it takes a while.
 */
export async function stageGoAssets({ mode = "debug", requireUi = false } = {}) {
  await stageSkills();

  const uiSource = path.join(repoDir, "packages/local-app/dist");
  const uiDir = path.join(assetsDir, "localui");
  await resetDir(uiDir);
  if (await exists(path.join(uiSource, "index.html"))) {
    await cp(uiSource, uiDir, { recursive: true });
  } else if (requireUi) {
    throw new Error("missing local UI assets; build @everr/local-app before building the CLI");
  } else {
    console.warn("Local UI not built; `everr local start` will serve no UI.");
  }

  const chdbZst = path.join(chdbCacheDir, mode, "libchdb.so.zst");
  // macOS release builds sign libchdb before compressing it, so a cached copy
  // is reused only when it was signed with the same identity.
  const signerFile = `${chdbZst}.signer`;
  const signer = chdbSigningIdentity(mode);
  const cachedSigner = await readFile(signerFile, "utf8").catch(() => "");
  if (!(await exists(chdbZst)) || cachedSigner !== signer) {
    const lib = await prepareChdbLibAt(mode, path.join(chdbCacheDir, mode, "libchdb.so"));
    await zstdFile(lib, chdbZst);
    await writeFile(signerFile, signer);
  }
  const chdbDir = path.join(assetsDir, "chdb");
  await resetDir(chdbDir);
  await linkOrCopy(chdbZst, path.join(chdbDir, "libchdb.so.zst"));
  // The CLI caches the extracted library under this digest.
  await writeFile(path.join(chdbDir, "libchdb.so.zst.sha256"), `${await sha256File(chdbZst)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? "debug";
  await stageGoAssets({ mode });
}
