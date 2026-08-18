import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { ArrowUpRight, Download, GitBranch } from "lucide-react";
import { INSTALL_COMMAND } from "@/common/install-command";
import { InstallCommandBlock } from "@/components/install-command-block";

export function InstallEverrCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="size-4 text-primary" />
          Install Everr
        </CardTitle>
        <CardDescription>
          Get notified when CI fails, run queries from your terminal, and
          integrate with your coding assistant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <InstallCommandBlock command={INSTALL_COMMAND} />
      </CardContent>
    </Card>
  );
}

/** Stands in for the CI tiles until a GitHub app installation is active. */
export function ConnectGithubCard() {
  return (
    <Card className="sm:col-span-2 lg:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="size-4 text-primary" />
          Connect GitHub
        </CardTitle>
        <CardDescription>
          Install the Everr GitHub app to track workflow runs, test results, and
          CI cost for your repositories.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          render={
            <a href="/api/github/install/start" target="_blank" rel="noopener">
              Install GitHub app
              <ArrowUpRight className="size-4" />
            </a>
          }
        />
      </CardContent>
    </Card>
  );
}
