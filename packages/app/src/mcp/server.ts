import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBranchStatusTools } from "./tools/ci-status";
import { registerCostsTools } from "./tools/costs";
import { registerOverviewTools } from "./tools/overview";
import { registerPerformanceTools } from "./tools/performance";
import { registerRunsTools } from "./tools/runs";
import { registerTestsTools } from "./tools/tests";
import { registerWorkflowsTools } from "./tools/workflows";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "citric",
    version: "0.1.0",
  });

  registerOverviewTools(server);
  registerBranchStatusTools(server);
  registerRunsTools(server);
  registerWorkflowsTools(server);
  registerTestsTools(server);
  registerCostsTools(server);
  registerPerformanceTools(server);

  return server;
}
