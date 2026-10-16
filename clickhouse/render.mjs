import { cp, mkdir, readFile, readdir, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const [target, output] = process.argv.slice(2);
if (!["cloud", "self-hosted"].includes(target) || !output) {
  throw new Error("Usage: node render.mjs <cloud|self-hosted> <output-directory>");
}
const root = fileURLToPath(new URL(".", import.meta.url));
const destination = resolve(output);
await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length) {
  throw new Error("Schema output directory must be empty; do not mix storage builds.");
}
await cp(join(root, "init"), destination, { recursive: true });
const fragments = {
  keyPrefix: "", jsonProjection: "", mapSchemaProjection: "", mapProjection: "",
  lookupColumn: "", tenantCodec: "", alertColumn: "", sqlPolicies: "", sqlAccess: "",
};
if (target === "cloud") {
  Object.assign(fragments, JSON.parse(await readFile(join(root, "cloud/schema.json"), "utf8")));
  fragments.sqlPolicies = await readFile(join(root, "cloud/sql-policies.sql"), "utf8");
  fragments.sqlAccess = await readFile(join(root, "cloud/sql-access.sql"), "utf8");
  for (const file of await readdir(join(root, "cloud"))) {
    if (/^\d.*\.sql$/.test(file)) await cp(join(root, "cloud", file), join(destination, file));
  }
} else {
  await cp(join(root, "self-hosted"), destination, { recursive: true });
}
for (const file of await readdir(join(root, "schema"))) {
  const source = await readFile(join(root, "schema", file), "utf8");
  const rendered = source.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in fragments)) throw new Error(`Unknown schema fragment: ${name}`);
    return fragments[name];
  });
  await writeFile(join(destination, file.replace(/\.tpl$/, "")), rendered);
}
for (const file of await readdir(destination)) {
  if (file.endsWith(".sh")) await chmod(join(destination, file), 0o755);
}
