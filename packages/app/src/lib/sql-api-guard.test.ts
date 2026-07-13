import { describe, expect, it } from "vitest";
import { assertSqlApiQueryAllowed } from "./sql-api-guard";

describe("assertSqlApiQueryAllowed", () => {
  it.each([
    ["canonical call", "SELECT hostName()"],
    ["lowercase alias", "SELECT hostname()"],
    ["uptime", "SELECT uptime()"],
    ["FQDN", "SELECT FQDN()"],
    ["FQDN case-insensitive alias", "SELECT fqdn()"],
    ["fullHostName alias", "SELECT fullHostName()"],
    ["displayName", "SELECT displayName()"],
    ["serverUUID", "SELECT serverUUID()"],
    ["tcpPort", "SELECT tcpPort()"],
    ["getServerSetting", "SELECT getServerSetting('tcp_port')"],
    ["getMacro", "SELECT getMacro('replica')"],
    ["backtick-quoted call", "SELECT `hostName`()"],
    ["double-quote-quoted call", 'SELECT "hostName"()'],
    ["comment between name and parens", "SELECT uptime/*x*/()"],
    ["nested in an expression", "SELECT concat(hostName(), 'x') FROM traces"],
    ["inside a subquery", "SELECT * FROM (SELECT hostName() AS h)"],
    [
      "inside WHERE on a granted table",
      "SELECT count() FROM traces WHERE ServiceName = hostName()",
    ],
    ["APPLY with the function name", "SELECT * APPLY hostName FROM traces"],
  ])("rejects %s", (_name, sql) => {
    expect(() => assertSqlApiQueryAllowed(sql)).toThrowError(
      /server introspection functions/,
    );
  });

  it.each([
    ["plain telemetry query", "SELECT ServiceName FROM traces LIMIT 10"],
    [
      "blocked word inside a string literal",
      "SELECT SpanAttributes['process.uptime'] FROM traces",
    ],
    [
      "blocked word inside a literal with escaped quotes",
      "SELECT 'it''s the uptime' , 'a \\' hostname'",
    ],
    ["blocked word inside a line comment", "SELECT 1 -- check uptime later"],
    ["blocked word inside a block comment", "SELECT 1 /* hostName() */"],
    [
      "identifier that merely contains a blocked word",
      "SELECT uptime_seconds, host_name FROM (SELECT 1 AS uptime_seconds, 'x' AS host_name)",
    ],
    [
      "column alias resembling but not matching",
      "SELECT count() AS uptimes FROM traces",
    ],
  ])("allows %s", (_name, sql) => {
    expect(() => assertSqlApiQueryAllowed(sql)).not.toThrow();
  });

  it("names the offending function in the error", () => {
    expect(() => assertSqlApiQueryAllowed("SELECT hostName()")).toThrowError(
      /"hostName"/,
    );
  });
});
