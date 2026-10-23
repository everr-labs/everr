import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

if (process.argv.slice(2).some((arg) => ["--help", "-h", "--dry-run"].includes(arg))) {
  process.exit(0);
}

const root = process.env.DEV_ROOT;
if (!root) throw new Error("DEV_ROOT is required");
const worktrees = execFileSync("git", ["worktree", "list", "--porcelain", "-z"], {
  cwd: root,
  encoding: "utf8",
});
const mainRoot = worktrees.split("\0")[0].slice("worktree ".length);

for (const product of ["app", "cloud"]) {
  const directory = path.join(root, "packages", product);
  const files = [".env", ".env.local", ".env.development", ".env.development.local"];
  const existing = readdirSync(directory);
  if (files.some((file) => existing.includes(file))) continue;

  const source = path.join(mainRoot, "packages", product, ".env");
  if (!statSync(source, { throwIfNoEntry: false })?.isFile()) {
    console.error(
      `No packages/${product}/.env found in the main worktree. Configure it using packages/${product}/.env.example, or supply environment variables.`,
    );
    continue;
  }

  writeFileSync(path.join(directory, ".env"), readFileSync(source), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Initialized packages/${product}/.env from main worktree`);
}
