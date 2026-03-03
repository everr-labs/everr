import { createFileRoute } from "@tanstack/react-router";
import { AccessTokenPanel } from "@/components/access-token-panel";

export const Route = createFileRoute("/dashboard/cli-token")({
  staticData: { breadcrumb: "CLI Token", hideTimeRangePicker: true },
  component: CliTokenPage,
});

function CliTokenPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">CLI Token</h1>
        <p className="text-muted-foreground">
          Generate an access token for the Everr CLI.
        </p>
      </div>

      <AccessTokenPanel showCopyButton={false} />
    </div>
  );
}
