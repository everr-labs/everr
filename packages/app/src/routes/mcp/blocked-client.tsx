import { Button } from "@everr/ui/components/button";
import { CopyStateIcon } from "@everr/ui/components/copy-state-icon";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldX } from "lucide-react";
import { useRef } from "react";
import { describeRedirectUri } from "#app/lib/mcp-redirect-uri.ts";
import { OAuthShell } from "./-components/oauth-shell";

const MCP_DOCS = "https://everr.dev/docs/reference/mcp";

export const Route = createFileRoute("/mcp/blocked-client")({
  validateSearch: (s: Record<string, unknown>): { redirect_uri?: string } => ({
    redirect_uri: typeof s.redirect_uri === "string" ? s.redirect_uri : undefined,
  }),
  component: BlockedClient,
});

function reportText(redirectUri: string) {
  return {
    title: `Allow an MCP client callback: ${redirectUri}`,
    body: [
      "Everr blocked an MCP client because its OAuth callback is not on the allowlist.",
      "",
      `Callback URI: ${redirectUri}`,
      "App name and link: ",
    ].join("\n"),
  };
}

function BlockedClient() {
  // Anyone can link here with any value: render it only as text.
  const redirectUri = Route.useSearch().redirect_uri ?? "";
  const destination = describeRedirectUri(redirectUri);
  const report = reportText(redirectUri || "(missing)");
  const issueUrl = `https://github.com/everr-labs/everr/issues/new?${new URLSearchParams(report)}`;
  const mailUrl = `mailto:hello@everr.dev?subject=${encodeURIComponent(report.title)}&body=${encodeURIComponent(report.body)}`;

  return (
    <OAuthShell
      title="This app can't connect to Everr"
      description="Everr sends sign-ins only to apps on your computer and to known AI clients."
    >
      <div className="flex gap-3 rounded-lg bg-accent/60 px-3 py-2.5">
        <ShieldX className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">The app wanted your sign-in sent to</p>
          <p className="mt-0.5 break-all font-mono text-base font-semibold text-foreground">
            {destination?.address ?? "An unknown address"}
          </p>
        </div>
      </div>

      {redirectUri ? <CallbackUri value={redirectUri} /> : null}

      <ol className="mt-5 flex list-decimal flex-col gap-3 pl-5 text-sm text-foreground marker:text-muted-foreground">
        <li>
          Connect from an app on your computer instead: Claude Code, Codex CLI, Cursor, VS Code or
          OpenCode.{" "}
          <a className="text-primary underline underline-offset-4" href={MCP_DOCS}>
            Setup guide
          </a>
        </li>
        <li>
          Report the app so we can review it.{" "}
          <a
            className="text-primary underline underline-offset-4"
            href={issueUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open a GitHub issue
          </a>{" "}
          or{" "}
          <a className="text-primary underline underline-offset-4" href={mailUrl}>
            email hello@everr.dev
          </a>
          .
        </li>
        <li>
          Self-hosting Everr? Add the callback URI to{" "}
          <code className="font-mono text-xs">MCP_OAUTH_ALLOWED_REDIRECT_URIS</code> and restart.
        </li>
      </ol>
    </OAuthShell>
  );
}

function CallbackUri({ value }: { value: string }) {
  const textRef = useRef<HTMLElement>(null);
  const { state, copy } = useCopyToClipboard(value, { selectOnFailure: textRef });
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/20 py-2 pl-3 pr-1.5">
      <code ref={textRef} className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
        {value}
      </code>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Copy callback URI"
        onClick={copy}
      >
        <CopyStateIcon copied={state === "copied"} />
      </Button>
    </div>
  );
}
