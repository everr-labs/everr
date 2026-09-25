import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Download } from "lucide-react";
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
