import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, OPENAPI_VERSION } from "./openapi";

const document = buildOpenApiDocument("https://everr.dev");

type Operation = {
  operationId?: string;
  description?: string;
  summary?: string;
  tags?: string[];
  parameters?: Array<Record<string, unknown>>;
  responses?: Record<string, { content?: Record<string, unknown> }>;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function operations(): Array<[string, string, Operation]> {
  const found: Array<[string, string, Operation]> = [];

  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, unknown>)[method];
      if (operation) found.push([path, method, operation as Operation]);
    }
  }

  return found;
}

describe("the published OpenAPI document", () => {
  it("declares a version, a server and a security scheme", () => {
    expect(document.openapi).toBe(OPENAPI_VERSION);
    expect(document.servers[0]?.url).toBe("https://app.everr.dev");
    expect(Object.keys(document.components.securitySchemes)).toEqual([
      "bearerAuth",
      "apiKeyAuth",
    ]);
  });

  it("describes at least the endpoints an agent needs", () => {
    for (const path of [
      "/api/health",
      "/api/cli/sql",
      "/api/cli/runs",
      "/api/cli/runs/{traceId}",
      "/api/cli/resources",
      "/api/apply",
      "/v1/traces",
    ]) {
      expect(Object.keys(document.paths)).toContain(path);
    }
  });

  it("gives every operation a unique operationId", () => {
    const ids = operations().map(([, , operation]) => operation.operationId);

    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every operation a summary, a description and a tag", () => {
    for (const [path, method, operation] of operations()) {
      const where = `${method.toUpperCase()} ${path}`;
      expect(operation.summary, where).toBeTruthy();
      expect(operation.description, where).toBeTruthy();
      expect(operation.tags?.length, where).toBeGreaterThan(0);
    }
  });

  it("types every parameter it declares", () => {
    for (const [path, method, operation] of operations()) {
      for (const parameter of operation.parameters ?? []) {
        if ("$ref" in parameter) continue;

        const where = `${method.toUpperCase()} ${path} ${String(parameter.name)}`;
        expect(parameter.in, where).toBeTruthy();
        expect(parameter.description, where).toBeTruthy();
        expect(parameter.schema, where).toBeTruthy();
      }
    }
  });

  it("gives every operation a success response with a schema", () => {
    for (const [path, method, operation] of operations()) {
      const where = `${method.toUpperCase()} ${path}`;
      const success = operation.responses?.["200"];

      expect(success, where).toBeTruthy();
      const contentTypes = Object.keys(success?.content ?? {});
      expect(contentTypes.length, where).toBeGreaterThan(0);
    }
  });

  it("returns the shared error schema on every failure response", () => {
    for (const [path, method, operation] of operations()) {
      for (const [status, response] of Object.entries(
        operation.responses ?? {},
      )) {
        if (status === "200") continue;

        const schema = (
          response.content?.["application/json"] as
            | { schema?: { $ref?: string } }
            | undefined
        )?.schema;
        expect(schema?.$ref, `${method.toUpperCase()} ${path} ${status}`).toBe(
          "#/components/schemas/Error",
        );
      }
    }
  });

  it("resolves every local $ref it uses", () => {
    const serialized = JSON.stringify(document);
    const refs = new Set(
      [...serialized.matchAll(/"#\/components\/(\w+)\/(\w+)"/g)].map(
        (match) => `${match[1]}.${match[2]}`,
      ),
    );

    for (const ref of refs) {
      const [section, name] = ref.split(".");
      const components = document.components as Record<
        string,
        Record<string, unknown>
      >;
      expect(components[section as string]?.[name as string], ref).toBeTruthy();
    }
  });

  it("points documentation and contact links at the site it is served from", () => {
    expect(document.externalDocs.url).toBe("https://everr.dev/docs");
    expect(document.info.contact.url).toBe("https://everr.dev/contact");
  });
});
