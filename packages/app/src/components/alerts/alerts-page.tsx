import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@everr/ui/components/tabs";
import { ExternalLink, Save, XCircle } from "lucide-react";
import { useState } from "react";
import type {
  ActiveAlertListItem,
  AlertEventListItem,
  AlertRuleListItem,
  RoutingListItem,
  SaveRoutingListInput,
} from "@/data/alerts/schemas";

type AlertsPageProps = {
  rules: AlertRuleListItem[];
  activeAlerts: ActiveAlertListItem[];
  events: AlertEventListItem[];
  routingLists: RoutingListItem[];
  canManage: boolean;
  onDeactivateRule: (id: number) => void;
  onSaveRoutingList: (input: SaveRoutingListInput) => void;
};

export function AlertsPage({
  rules,
  activeAlerts,
  events,
  routingLists,
  canManage,
  onDeactivateRule,
  onSaveRoutingList,
}: AlertsPageProps) {
  const [routingSlug, setRoutingSlug] = useState("");
  const [routingName, setRoutingName] = useState("");
  const [routingUsers, setRoutingUsers] = useState("");

  const saveRoutingList = (event: React.FormEvent) => {
    event.preventDefault();
    onSaveRoutingList({
      slug: routingSlug.trim(),
      name: routingName.trim(),
      userIds: routingUsers
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
        <p className="text-muted-foreground">
          Query-based alerts, current firing state, history, and routing.
        </p>
      </div>

      <Tabs defaultValue="rules" className="space-y-4">
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="active">Active alerts</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="routing">Routing lists</TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <RulesTable
            rules={rules}
            canManage={canManage}
            onDeactivateRule={onDeactivateRule}
          />
        </TabsContent>

        <TabsContent value="active">
          <ActiveAlertsTable alerts={activeAlerts} />
        </TabsContent>

        <TabsContent value="history">
          <AlertEventsTable events={events} />
        </TabsContent>

        <TabsContent value="routing">
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <RoutingListsTable routingLists={routingLists} />
            {canManage && (
              <form
                className="space-y-3 rounded-md border bg-background p-3"
                onSubmit={saveRoutingList}
              >
                <div>
                  <h2 className="text-sm font-semibold">Custom list</h2>
                  <p className="text-muted-foreground text-xs">
                    Use user ids separated by commas.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="routing-slug">Slug</Label>
                  <Input
                    id="routing-slug"
                    value={routingSlug}
                    onChange={(event) => setRoutingSlug(event.target.value)}
                    placeholder="platform"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="routing-name">Name</Label>
                  <Input
                    id="routing-name"
                    value={routingName}
                    onChange={(event) => setRoutingName(event.target.value)}
                    placeholder="Platform"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="routing-users">Users</Label>
                  <Input
                    id="routing-users"
                    value={routingUsers}
                    onChange={(event) => setRoutingUsers(event.target.value)}
                    placeholder="user_1,user_2"
                  />
                </div>
                <Button type="submit" size="sm">
                  <Save />
                  Save
                </Button>
              </form>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RulesTable({
  rules,
  canManage,
  onDeactivateRule,
}: {
  rules: AlertRuleListItem[];
  canManage: boolean;
  onDeactivateRule: (id: number) => void;
}) {
  const columns: Column<AlertRuleListItem>[] = [
    {
      header: "Rule",
      className: "pb-2 pl-3 pr-4 w-full",
      cellClassName: "py-2 pl-3 pr-4 w-full max-w-0",
      cell: (rule) => (
        <div className="min-w-0">
          <div className="truncate font-medium">
            {rule.service} / {rule.name}
          </div>
          <div className="text-muted-foreground text-xs">
            {formatSeconds(rule.evaluationIntervalSeconds)} interval,{" "}
            {formatSeconds(rule.windowSeconds)} window
          </div>
        </div>
      ),
    },
    {
      header: "Severity",
      cell: (rule) => <SeverityBadge severity={rule.severity} />,
    },
    {
      header: "Routing",
      cell: (rule) => (
        <span className="whitespace-nowrap">{rule.routingSlug}</span>
      ),
    },
    {
      header: "Status",
      cell: (rule) => (
        <div className="flex flex-col gap-1">
          <Badge variant={rule.active ? "secondary" : "outline"}>
            {rule.active ? "Active" : "Inactive"}
          </Badge>
          {rule.stateStatus && (
            <Badge variant="outline">{rule.stateStatus}</Badge>
          )}
        </div>
      ),
    },
    {
      header: "Last check",
      cell: (rule) => (
        <span className="text-muted-foreground whitespace-nowrap text-xs">
          {rule.lastEvaluationStatus ?? "Not evaluated"}
        </span>
      ),
    },
    {
      header: "Source",
      cell: (rule) => <SourceLink href={rule.sourceUrl} />,
    },
  ];

  if (canManage) {
    columns.push({
      header: "",
      cell: (rule) =>
        rule.active ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onDeactivateRule(rule.id)}
          >
            <XCircle />
            Deactivate
          </Button>
        ) : null,
    });
  }

  return (
    <DataTable
      data={rules}
      columns={columns}
      rowKey={(rule) => String(rule.id)}
      emptyState={<EmptyState message="No alert rules uploaded" />}
    />
  );
}

function ActiveAlertsTable({ alerts }: { alerts: ActiveAlertListItem[] }) {
  const columns: Column<ActiveAlertListItem>[] = [
    {
      header: "Alert",
      className: "pb-2 pl-3 pr-4 w-full",
      cellClassName: "py-2 pl-3 pr-4 w-full max-w-0",
      cell: (alert) => (
        <div className="min-w-0">
          <div className="truncate font-medium">
            {alert.service} / {alert.name}
          </div>
          <div className="text-muted-foreground text-xs">
            {alert.rowCount} matching rows
          </div>
        </div>
      ),
    },
    {
      header: "Severity",
      cell: (alert) => <SeverityBadge severity={alert.severity} />,
    },
    {
      header: "Routing",
      cell: (alert) => (
        <span className="whitespace-nowrap">{alert.routingSlug}</span>
      ),
    },
    {
      header: "First fired",
      cell: (alert) => (
        <span className="text-muted-foreground whitespace-nowrap text-xs">
          {formatDate(alert.firstFiredAt)}
        </span>
      ),
    },
    {
      header: "Last seen",
      cell: (alert) => (
        <span className="text-muted-foreground whitespace-nowrap text-xs">
          {formatDate(alert.lastSeenAt)}
        </span>
      ),
    },
    {
      header: "Source",
      cell: (alert) => <SourceLink href={alert.sourceUrl} />,
    },
  ];

  return (
    <DataTable
      data={alerts}
      columns={columns}
      rowKey={(alert) => String(alert.alertDefinitionId)}
      emptyState={<EmptyState message="No active alerts" />}
    />
  );
}

function AlertEventsTable({ events }: { events: AlertEventListItem[] }) {
  const columns: Column<AlertEventListItem>[] = [
    {
      header: "Event",
      className: "pb-2 pl-3 pr-4 w-full",
      cellClassName: "py-2 pl-3 pr-4 w-full max-w-0",
      cell: (event) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{event.summary}</div>
          <div className="text-muted-foreground truncate text-xs">
            {event.service} / {event.name}
          </div>
        </div>
      ),
    },
    {
      header: "Type",
      cell: (event) => <Badge variant="outline">{event.type}</Badge>,
    },
    {
      header: "Severity",
      cell: (event) => <SeverityBadge severity={event.severity} />,
    },
    {
      header: "Rows",
      cell: (event) => <span className="tabular-nums">{event.rowCount}</span>,
    },
    {
      header: "Occurred",
      cell: (event) => (
        <span className="text-muted-foreground whitespace-nowrap text-xs">
          {formatDate(event.occurredAt)}
        </span>
      ),
    },
    {
      header: "Source",
      cell: (event) => <SourceLink href={event.sourceUrl} />,
    },
  ];

  return (
    <DataTable
      data={events}
      columns={columns}
      rowKey={(event) => String(event.id)}
      emptyState={<EmptyState message="No alert events" />}
    />
  );
}

function RoutingListsTable({
  routingLists,
}: {
  routingLists: RoutingListItem[];
}) {
  const columns: Column<RoutingListItem>[] = [
    {
      header: "List",
      className: "pb-2 pl-3 pr-4 w-full",
      cellClassName: "py-2 pl-3 pr-4 w-full max-w-0",
      cell: (list) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{list.name}</span>
            {list.builtIn && <Badge variant="outline">Default</Badge>}
          </div>
          <div className="text-muted-foreground text-xs">{list.slug}</div>
        </div>
      ),
    },
    {
      header: "Members",
      cell: (list) => (
        <div className="flex min-w-56 flex-wrap gap-1">
          {list.members.length > 0 ? (
            list.members.map((member) => (
              <Badge key={member.userId} variant="secondary">
                {member.name || member.email}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground text-xs">No members</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      data={routingLists}
      columns={columns}
      rowKey={(list) => list.slug}
      emptyState={<EmptyState message="No routing lists" />}
    />
  );
}

function SeverityBadge({ severity }: { severity: "critical" | "warning" }) {
  return (
    <Badge variant={severity === "critical" ? "destructive" : "secondary"}>
      {severity}
    </Badge>
  );
}

function SourceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap text-primary text-xs hover:underline"
    >
      Source
      <ExternalLink className="size-3" />
    </a>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Empty>
      <EmptyDescription>{message}</EmptyDescription>
    </Empty>
  );
}

function formatSeconds(seconds: number): string {
  if (seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${seconds}s`;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}
