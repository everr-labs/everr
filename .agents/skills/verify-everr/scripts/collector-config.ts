// The verification collector config, generated at web-launch from this checkout's own
// collector/config.example.yml, so CORS, routing, exporters and processors always match the
// code under test. Only three things change:
//   1. receivers that need GitHub App secrets (githubactions) are removed, with every pipeline
//      that reads from them (the internal pipelines that trust x-everr-tenant-id);
//   2. endpoints move to this run's loopback ports (the container uses host networking), and
//      every API-key auth extension verifies against this run's app with the run's secret;
//   3. the collector's own metrics are turned off (they would bind :8888 on the host).
// The shared secret stays an env reference (${env:INGEST_VERIFY_SHARED_SECRET}), set per run by
// compose.verify.yaml, so the generated file holds no secret.
import { createRequire } from "node:module";
import path from "node:path";
import { REPO, die, isRecord, readText } from "./common.ts";

export const EXAMPLE_CONFIG = path.join(REPO, "collector/config.example.yml");

/** Receivers the verification stack cannot run: they need GitHub App secrets. */
const SECRET_RECEIVERS = ["githubactions"];

type YamlDoc = {
  errors: { message: string }[];
  toJS(): unknown;
  deleteIn(path: unknown[]): boolean;
  setIn(path: unknown[], value: unknown): void;
  toString(options?: Record<string, unknown>): string;
};
type YamlModule = { parseDocument(source: string): YamlDoc };

/** The `yaml` package the app already depends on (packages/app), so the skill needs no deps of its own. */
function loadYaml(): YamlModule {
  try {
    return createRequire(path.join(REPO, "packages/app/package.json"))("yaml") as YamlModule;
  } catch {
    return die("cannot load the 'yaml' package from packages/app; run 'pnpm install' in the repo");
  }
}

export type CollectorPorts = {
  otlpHttp: number | string;
  otlpGrpc: number | string;
  clickhouse: number | string;
  /** The run's app origin; everr_apikey calls <origin>/api/internal/verify-key. */
  web: string;
};

export type GeneratedConfig = {
  text: string;
  /** Pipelines kept, with their receivers and exporters. */
  pipelines: Record<string, { receivers: string[]; exporters: string[] }>;
  removedPipelines: string[];
  /** Every exporter defined in the example. */
  exporters: string[];
  /** cors.allowed_headers of the public OTLP/HTTP receiver, if any. */
  corsHeaders: string[];
  corsOrigins: string[];
};

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function generateCollectorConfig(ports: CollectorPorts, source = EXAMPLE_CONFIG): GeneratedConfig {
  const { parseDocument } = loadYaml();
  const raw = readText(source) ?? die(`missing ${source}`);
  const doc = parseDocument(raw);
  if (doc.errors.length) die(`cannot parse ${source}: ${doc.errors[0].message}`);
  const json = doc.toJS() as Record<string, unknown>;
  const receivers = isRecord(json.receivers) ? json.receivers : {};
  const exporters = isRecord(json.exporters) ? json.exporters : {};
  const connectors = isRecord(json.connectors) ? Object.keys(json.connectors) : [];
  const service = isRecord(json.service) ? json.service : {};
  const pipelines = isRecord(service.pipelines) ? service.pipelines : {};

  const removedReceivers = SECRET_RECEIVERS.filter((r) => r in receivers);
  for (const r of removedReceivers) doc.deleteIn(["receivers", r]);
  const kept: GeneratedConfig["pipelines"] = {};
  const removedPipelines: string[] = [];
  for (const [name, p] of Object.entries(pipelines)) {
    const rec = asList(isRecord(p) ? p.receivers : undefined);
    if (rec.some((r) => removedReceivers.includes(r))) {
      doc.deleteIn(["service", "pipelines", name]);
      removedPipelines.push(name);
    } else {
      kept[name] = { receivers: rec, exporters: asList(isRecord(p) ? p.exporters : undefined) };
    }
  }
  // A connector must stay both an exporter and a receiver of the kept pipelines, or the collector refuses to start.
  for (const c of connectors) {
    const out = Object.values(kept).some((p) => p.exporters.includes(c));
    const into = Object.values(kept).some((p) => p.receivers.includes(c));
    if (out !== into) die(`collector config: connector '${c}' is only used as ${out ? "an exporter" : "a receiver"} after removing ${removedPipelines.join(", ")}`);
  }
  const unknown = Object.values(kept).flatMap((p) => p.receivers).filter((r) => !(r in receivers) && !connectors.includes(r));
  if (unknown.length) die(`collector config: kept pipelines read from unknown receivers ${unknown.join(", ")}`);

  // Endpoints: every OTLP receiver protocol and every exporter that points at the compose ClickHouse.
  let corsHeaders: string[] = [];
  let corsOrigins: string[] = [];
  for (const [name, r] of Object.entries(receivers)) {
    if (removedReceivers.includes(name) || !isRecord(r) || !isRecord(r.protocols)) continue;
    if (isRecord(r.protocols.http)) {
      doc.setIn(["receivers", name, "protocols", "http", "endpoint"], `127.0.0.1:${ports.otlpHttp}`);
      const cors = r.protocols.http.cors;
      if (isRecord(cors)) {
        corsHeaders = asList(cors.allowed_headers);
        corsOrigins = asList(cors.allowed_origins);
      }
    }
    if (isRecord(r.protocols.grpc)) doc.setIn(["receivers", name, "protocols", "grpc", "endpoint"], `127.0.0.1:${ports.otlpGrpc}`);
  }
  for (const [name, e] of Object.entries(exporters)) {
    if (isRecord(e) && typeof e.endpoint === "string" && /^https?:\/\/clickhouse:8123\b/.test(e.endpoint)) {
      doc.setIn(["exporters", name, "endpoint"], `http://127.0.0.1:${ports.clickhouse}`);
    }
  }
  const extensions = isRecord(json.extensions) ? json.extensions : {};
  const apiKeyAuth = Object.keys(extensions).filter((n) => n === "everr_apikey" || n.startsWith("everr_apikey/"));
  if (!apiKeyAuth.length) die("collector config: no everr_apikey extension; public ingest would be unauthenticated");
  for (const n of apiKeyAuth) {
    doc.setIn(["extensions", n, "endpoint"], `${ports.web}/api/internal/verify-key`);
    doc.setIn(["extensions", n, "shared_secret"], "${env:INGEST_VERIFY_SHARED_SECRET}");
  }
  doc.setIn(["service", "telemetry", "metrics", "level"], "none");

  const header = [
    "# GENERATED by verify-everr web-launch from collector/config.example.yml. Do not edit:",
    `# removed receivers: ${removedReceivers.join(", ") || "none"}; removed pipelines: ${removedPipelines.join(", ") || "none"};`,
    "# OTLP, ClickHouse and verify-key endpoints rewritten to this run's loopback ports; self-metrics off.",
    "",
  ].join("\n");
  const text = header + doc.toString({ lineWidth: 0 });
  const leftovers = text.split("\n").filter((l) => !l.trimStart().startsWith("#") && /clickhouse:8123|0\.0\.0\.0:|host\.docker\.internal/.test(l));
  if (leftovers.length) die(`collector config still points outside the run: ${leftovers[0].trim()}`);
  return { text, pipelines: kept, removedPipelines, exporters: Object.keys(exporters), corsHeaders, corsOrigins };
}
