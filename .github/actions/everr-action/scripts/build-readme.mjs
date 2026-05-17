import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const actionRoot = path.resolve(here, "..");
const actionYml = yaml.load(fs.readFileSync(path.join(actionRoot, "action.yml"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(actionRoot, "package.json"), "utf8"));

const inputs = Object.entries(actionYml.inputs || {});
const inputsTable = inputs.length
  ? [
      "| Name | Required | Default | Description |",
      "| --- | --- | --- | --- |",
      ...inputs.map(([name, spec]) => {
        const required = spec.required ? "yes" : "no";
        const defaultValue = spec.default === undefined ? "—" : `\`${spec.default}\``;
        const description = (spec.description || "").replace(/\n/g, " ").trim();
        return `| \`${name}\` | ${required} | ${defaultValue} | ${description} |`;
      }),
    ].join("\n")
  : "_This action has no inputs._";

const readme = `# ${actionYml.name}

${actionYml.description}

> Built from \`everr-labs/everr\` at version \`${pkg.version}\`. Do not edit
> this repository directly; changes are overwritten on each release.

## Usage

\`\`\`yaml
permissions:
  contents: read
  actions: read

steps:
  - uses: everr-labs/everr-action@v0
    with:
      resource-usage: "true"
\`\`\`

> The action needs \`actions: read\` so it can look up its own job via
> the GitHub Jobs API to derive a \`check_run_id\`. The default
> \`github-token\` input uses the workflow's GITHUB_TOKEN.

## Inputs

${inputsTable}
`;

const outPath = path.join(actionRoot, "README.generated.md");
fs.writeFileSync(outPath, readme, "utf8");
console.log(`wrote ${outPath}`);
