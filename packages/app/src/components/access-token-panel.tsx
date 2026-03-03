import { WandSparkles } from "lucide-react";
import { useId, useState } from "react";
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

interface AccessTokenPanelProps {
  title?: string;
  description?: string;
  emptyTokenPlaceholder?: string;
  showCopyButton?: boolean;
}

export function AccessTokenPanel({
  title = "Generate token",
  description = "This token is shown only once",
  emptyTokenPlaceholder = "<generate-a-token-first>",
  showCopyButton = true,
}: AccessTokenPanelProps) {
  const [generatedToken, setGeneratedToken] = useState<string>("");
  const [maskedToken, setMaskedToken] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const tokenFieldId = useId();

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WandSparkles className="size-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
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
          <label htmlFor={tokenFieldId} className="text-xs font-medium">
            Access token
          </label>
          <div className="flex gap-2">
            <Textarea
              id={tokenFieldId}
              readOnly
              value={generatedToken || emptyTokenPlaceholder}
            />
            {showCopyButton ? (
              <Button
                variant="outline"
                disabled={!generatedToken}
                onClick={() =>
                  void navigator.clipboard.writeText(generatedToken)
                }
              >
                Copy
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
