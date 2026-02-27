import { createFileRoute } from "@tanstack/react-router";
import { SquareArrowOutUpRight, WandSparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { createAccessToken } from "@/data/access-tokens";

export const Route = createFileRoute("/dashboard/mcp-server")({
  staticData: { breadcrumb: "MCP Server", hideTimeRangePicker: true },
  component: McpServerSetupPage,
});

function McpServerSetupPage() {
  const [generatedToken, setGeneratedToken] = useState<string>("");
  const [maskedToken, setMaskedToken] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const mcpEndpoint = useMemo(() => {
    if (typeof window === "undefined") {
      return "/api/mcp";
    }
    return `${window.location.origin}/api/mcp`;
  }, []);
  const tokenForInstructions = generatedToken || "<YOUR_MCP_TOKEN>";

  async function handleGenerateToken() {
    if (isGenerating) {
      return;
    }

    setCreateError(null);
    setIsGenerating(true);

    try {
      const token = await createAccessToken();
      setGeneratedToken(token.value);
      setMaskedToken(token.obfuscatedValue);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "We couldn't generate an API token right now.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyToClipboard(value: string) {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Access tokens</h1>
        <p className="text-muted-foreground">
          Generate a Everr MCP access token and configure your Code Assistant.
        </p>
      </div>

      <div className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WandSparkles className="size-4" />
              Step 1: Generate MCP access Token
            </CardTitle>
            <CardDescription>This token is shown only once</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => void handleGenerateToken()}
                disabled={isGenerating}
              >
                {isGenerating ? "Generating..." : "Generate token"}
              </Button>
              {maskedToken ? (
                <span className="text-muted-foreground text-xs">
                  Active key: {maskedToken}
                </span>
              ) : null}
            </div>

            {createError ? (
              <p className="text-xs text-destructive" role="alert">
                {createError}
              </p>
            ) : null}

            <div className="space-y-1">
              <label htmlFor="generated-token" className="text-xs font-medium">
                Access token
              </label>
              <div className="flex gap-2">
                <Textarea
                  id="generated-token"
                  readOnly
                  value={generatedToken || "<generate-a-token-first>"}
                />
                <Button
                  variant="outline"
                  disabled={!generatedToken}
                  onClick={() => void copyToClipboard(generatedToken)}
                >
                  Copy
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SquareArrowOutUpRight className="size-4" />
              Step 2: Configure Your Code Assistant
            </CardTitle>
            <CardDescription>
              Use this endpoint in Claude Code, Cursor, or anything that
              supports the Model Context Protocol (MCP).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="font-mono text-xs">{mcpEndpoint}</p>
            </div>

            <Tabs defaultValue="codex" className="w-full">
              <TabsList variant="line" className="w-full justify-start">
                <TabsTrigger value="codex">Codex</TabsTrigger>
                <TabsTrigger value="cursor">Cursor</TabsTrigger>
                <TabsTrigger value="opencode">OpenCode</TabsTrigger>
                <TabsTrigger value="claude">Claude</TabsTrigger>
              </TabsList>

              <TabsContent value="codex" className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  Add this to <code>~/.codex/config.toml</code>.
                </p>
                <pre className="overflow-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
                  {`[mcp_servers.citric]
url = "${mcpEndpoint}"

[mcp_servers.citric.http_headers]
Authorization = "Bearer ${tokenForInstructions}"`}
                </pre>
              </TabsContent>

              <TabsContent value="cursor" className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  Add this config in <code>~/.cursor/mcp.json</code> and restart
                  Cursor.
                </p>
                <pre className="overflow-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
                  {JSON.stringify(
                    {
                      mcpServers: {
                        citric: {
                          url: mcpEndpoint,
                          headers: {
                            Authorization: `Bearer ${tokenForInstructions}`,
                          },
                        },
                      },
                    },
                    null,
                    2,
                  )}
                </pre>
              </TabsContent>

              <TabsContent value="opencode" className="space-y-2">
                <pre className="overflow-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
                  {`opencode mcp add`}
                </pre>
                <p className="text-muted-foreground text-xs">
                  Run the add flow and configure a remote HTTP server:
                  <code className="ml-4 mt-1 block">name=citric</code>
                  <code className="ml-4 block">url={mcpEndpoint}</code>
                  <code className="ml-4 block">
                    Authorization: Bearer {tokenForInstructions}
                  </code>
                </p>
              </TabsContent>

              <TabsContent value="claude" className="space-y-2">
                <pre className="overflow-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
                  {`claude mcp add --transport http citric ${mcpEndpoint} \\
  --header "Authorization: Bearer ${tokenForInstructions}"`}
                </pre>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
