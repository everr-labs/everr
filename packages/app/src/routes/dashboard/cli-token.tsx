import { createFileRoute } from "@tanstack/react-router";
import { WandSparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { createAccessToken } from "@/data/access-tokens";

export const Route = createFileRoute("/dashboard/cli-token")({
  staticData: { breadcrumb: "CLI Token", hideTimeRangePicker: true },
  component: CliTokenPage,
});

function CliTokenPage() {
  const [generatedToken, setGeneratedToken] = useState<string>("");
  const [maskedToken, setMaskedToken] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
          : "We couldn't generate a token right now.",
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
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">CLI Token</h1>
        <p className="text-muted-foreground">
          Generate an access token for the Everr CLI.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WandSparkles className="size-4" />
            Generate token
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
    </div>
  );
}
