import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) throw new Error("Usage: release-metadata.ts <payload-directory>");
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const files = readdirSync(root).filter((name) => !["SHA256SUMS", "release-metadata.json"].includes(name)).sort().map((name) => {
  const bytes = readFileSync(path.join(root, name));
  return { path: name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const metadata = JSON.stringify({
  version,
  build: {
    github_sha: process.env.GITHUB_SHA ?? "unknown",
    github_run_id: process.env.GITHUB_RUN_ID ?? "unknown",
  },
  files,
}, null, 2) + "\n";
writeFileSync(path.join(root, "release-metadata.json"), metadata);
const sums = [...files, { path: "release-metadata.json", sha256: createHash("sha256").update(metadata).digest("hex") }].map((file) => `${file.sha256}  ${file.path}`).join("\n");
writeFileSync(path.join(root, "SHA256SUMS"), sums + "\n");
