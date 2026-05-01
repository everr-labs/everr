import path from "node:path";
import { fileURLToPath } from "node:url";
import { bumpDesktopAppVersion } from "./build-support.ts";

type DesktopVersionBump = "patch" | "minor" | "major";

const bumpArgs = new Map<string, DesktopVersionBump>([
  ["patch", "patch"],
  ["--patch", "patch"],
  ["minor", "minor"],
  ["--minor", "minor"],
  ["major", "major"],
  ["--major", "major"],
]);

export function parseDesktopVersionBumpArgs(args: string[]): DesktopVersionBump {
  let increment: DesktopVersionBump | undefined;

  for (const arg of args) {
    const parsed = bumpArgs.get(arg);
    if (!parsed) {
      throw new Error(
        `Unsupported desktop version bump "${arg}". Use patch, minor, or major.`,
      );
    }

    if (increment) {
      throw new Error("Choose only one desktop version bump: patch, minor, or major.");
    }

    increment = parsed;
  }

  return increment ?? "patch";
}

export async function bumpDesktopVersion(args = process.argv.slice(2)) {
  const increment = parseDesktopVersionBumpArgs(args);
  const result = await bumpDesktopAppVersion(increment);

  console.log(
    `Bumped desktop app version from ${result.previousVersion} to ${result.nextVersion}.`,
  );

  return {
    increment,
    ...result,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await bumpDesktopVersion();
}
