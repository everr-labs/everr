import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@everr/app/components/page-header";
export function MembersUnavailable() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Members"
        lede="Collaboration is available with the Pro plan."
      />
      <Card>
        <CardHeader>
          <CardTitle>Invite your team with Pro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hobby organizations are individual and can only contain their Owner.
            Upgrade to Pro to invite members and manage team access.
          </p>
          <Button nativeButton={false} render={<Link to="/billing" />}>
            View Pro plan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
