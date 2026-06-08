import { describe, expect, it } from "vitest";
import type { Variable } from "./schema";
import {
  draftFromVariable,
  emptyDraft,
  parseStaticValues,
  type VariableDraft,
  validateDraft,
  variableFromDraft,
  variableKindLabel,
} from "./variable-draft";

const textVariable: Variable = {
  kind: "TextVariable",
  spec: {
    name: "env",
    display: { name: "Environment", hidden: true },
    value: "prod",
    constant: true,
  },
};

const staticVariable: Variable = {
  kind: "ListVariable",
  spec: {
    name: "svc",
    defaultValue: "a",
    plugin: { kind: "StaticListVariable", spec: { values: ["a", "b"] } },
  },
};

const queryVariable: Variable = {
  kind: "ListVariable",
  spec: {
    name: "svc",
    allowAllValue: true,
    customAllValue: "%",
    plugin: {
      kind: "ClickHouseSQLVariable",
      spec: { query: "SELECT DISTINCT ServiceName FROM logs" },
    },
  },
};

function validStaticDraft(): VariableDraft {
  return { ...emptyDraft(), name: "svc", staticValues: "a\nb" };
}

describe("draft round-trips", () => {
  it("round-trips a text variable with value, constant, label and hidden", () => {
    expect(variableFromDraft(draftFromVariable(textVariable))).toEqual(
      textVariable,
    );
  });

  it("round-trips a minimal text variable without display", () => {
    const v: Variable = {
      kind: "TextVariable",
      spec: { name: "env", value: "" },
    };
    expect(variableFromDraft(draftFromVariable(v))).toEqual(v);
  });

  it("round-trips a static list with a single default", () => {
    expect(variableFromDraft(draftFromVariable(staticVariable))).toEqual(
      staticVariable,
    );
  });

  it("round-trips a static list with multi defaults", () => {
    const v: Variable = {
      kind: "ListVariable",
      spec: {
        name: "svc",
        defaultValue: ["a", "b"],
        allowMultiple: true,
        plugin: {
          kind: "StaticListVariable",
          spec: { values: ["a", "b", "c"] },
        },
      },
    };
    expect(variableFromDraft(draftFromVariable(v))).toEqual(v);
  });

  it("round-trips a query list with allowAllValue and customAllValue", () => {
    expect(variableFromDraft(draftFromVariable(queryVariable))).toEqual(
      queryVariable,
    );
  });
});

describe("variableKindLabel", () => {
  it("labels all three kinds", () => {
    expect(variableKindLabel(textVariable)).toBe("Text");
    expect(variableKindLabel(staticVariable)).toBe("Static list");
    expect(variableKindLabel(queryVariable)).toBe("Query list");
  });
});

describe("parseStaticValues", () => {
  it("splits lines, trims whitespace and drops empties", () => {
    expect(parseStaticValues(" a \n\n b\n")).toEqual(["a", "b"]);
  });
});

describe("validateDraft", () => {
  it("rejects invalid names", () => {
    expect(validateDraft({ ...validStaticDraft(), name: "1bad" }, [])).toMatch(
      /Name must start with a letter/,
    );
    expect(validateDraft({ ...validStaticDraft(), name: "" }, [])).toMatch(
      /Name must start with a letter/,
    );
  });

  it("rejects duplicate names", () => {
    expect(validateDraft(validStaticDraft(), ["svc"])).toBe(
      'A variable named "svc" already exists',
    );
  });

  it("accepts a re-used name when it is excluded (editing self)", () => {
    expect(validateDraft(validStaticDraft(), ["other"])).toBeNull();
  });

  it("rejects a static list with no values", () => {
    expect(
      validateDraft({ ...validStaticDraft(), staticValues: " \n " }, []),
    ).toBe("Add at least one value (one per line)");
  });

  it("rejects a query list with an empty query", () => {
    expect(
      validateDraft(
        {
          ...validStaticDraft(),
          pluginKind: "ClickHouseSQLVariable",
          query: "  ",
        },
        [],
      ),
    ).toBe("Query is required");
  });

  it("accepts a valid text draft", () => {
    expect(
      validateDraft({ ...emptyDraft(), kind: "TextVariable", name: "env" }, []),
    ).toBeNull();
  });

  it("accepts a valid query draft", () => {
    expect(
      validateDraft(
        {
          ...validStaticDraft(),
          pluginKind: "ClickHouseSQLVariable",
          query: "SELECT 1",
        },
        [],
      ),
    ).toBeNull();
  });
});

describe("variableFromDraft – preserves unexposed fields when editing", () => {
  it("keeps display.description, capturingRegexp, sort, and extra plugin spec", () => {
    const original: Variable = {
      kind: "ListVariable",
      spec: {
        name: "svc",
        display: { name: "Service", description: "the service" },
        capturingRegexp: "(.*)",
        sort: "alphabetical-asc",
        plugin: {
          kind: "ClickHouseSQLVariable",
          spec: { query: "select 1", refresh: "onLoad" },
        },
      },
    };
    const draft = draftFromVariable(original);
    draft.query = "select 2";
    draft.label = "Service Renamed";

    expect(variableFromDraft(draft, original)).toEqual({
      kind: "ListVariable",
      spec: {
        name: "svc",
        display: { name: "Service Renamed", description: "the service" },
        capturingRegexp: "(.*)",
        sort: "alphabetical-asc",
        plugin: {
          kind: "ClickHouseSQLVariable",
          spec: { query: "select 2", refresh: "onLoad" },
        },
      },
    });
  });

  it("preserves unknown top-level spec fields from imported dashboards", () => {
    const original = {
      kind: "TextVariable",
      spec: { name: "env", value: "prod", customPersesField: 42 },
    } as unknown as Variable;
    const draft = draftFromVariable(original);
    draft.value = "staging";

    const spec = variableFromDraft(draft, original).spec as Record<
      string,
      unknown
    >;
    expect(spec.value).toBe("staging");
    expect(spec.customPersesField).toBe(42);
  });

  it("clears a form-owned field the user turned off", () => {
    const original: Variable = {
      kind: "ListVariable",
      spec: {
        name: "svc",
        allowMultiple: true,
        plugin: { kind: "StaticListVariable", spec: { values: ["a"] } },
      },
    };
    const draft = draftFromVariable(original);
    draft.allowMultiple = false;

    const spec = variableFromDraft(draft, original).spec as Record<
      string,
      unknown
    >;
    expect(spec.allowMultiple).toBeUndefined();
  });

  it("discards original kind-specific fields when the kind changes", () => {
    const original: Variable = {
      kind: "ListVariable",
      spec: {
        name: "x",
        sort: "alphabetical-asc",
        plugin: { kind: "StaticListVariable", spec: { values: ["a"] } },
      },
    };
    const draft = draftFromVariable(original);
    draft.kind = "TextVariable";
    draft.value = "v";

    const result = variableFromDraft(draft, original);
    expect(result.kind).toBe("TextVariable");
    const spec = result.spec as Record<string, unknown>;
    expect(spec.sort).toBeUndefined();
    expect(spec.plugin).toBeUndefined();
  });
});
