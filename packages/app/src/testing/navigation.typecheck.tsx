import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { RailRow } from "#app/components/rail/rail-row.tsx";
import type { ApplicationPath } from "#app/composition/client.ts";
import type { NavGroup } from "#app/lib/navigation.ts";

function checkSharedNavigationTypes() {
  const validPath: ApplicationPath = "/runs";
  // @ts-expect-error Dynamic destinations need params and cannot be stored as plain application paths.
  const dynamicPath: ApplicationPath = "/runs/$traceId";
  // @ts-expect-error Application paths must exist in the registered route tree.
  const unknownPath: ApplicationPath = "/this-route-does-not-exist";

  const validNavigation: NavGroup[] = [
    { items: [{ title: "Runs", url: "/runs", icon: Activity }] },
  ];
  const invalidNavigation: NavGroup[] = [
    {
      items: [
        {
          title: "Unknown",
          // @ts-expect-error NavItem destinations must be registered routes.
          url: "/this-route-does-not-exist",
          icon: Activity,
        },
      ],
    },
  ];
  void validPath;
  void dynamicPath;
  void unknownPath;
  void validNavigation;
  void invalidNavigation;

  const unknownRailProps = {
    label: "Unknown",
    icon: Activity,
    to: "/this-route-does-not-exist",
  } as const;
  const missingParamsRailProps = {
    label: "Trace",
    icon: Activity,
    to: "/runs/$traceId",
  } as const;
  const wrongParamKeyRailProps = {
    label: "Trace",
    icon: Activity,
    to: "/runs/$traceId",
    params: { traceID: "trace-id" },
  } as const;
  const wrongParamTypeRailProps = {
    label: "Trace",
    icon: Activity,
    to: "/runs/$traceId",
    params: { traceId: 123 },
  } as const;
  const activePropsRailProps = {
    label: "Runs",
    icon: Activity,
    to: "/runs",
    activeProps: {},
  } as const;
  const invalidSearchRailProps = {
    label: "Runs",
    icon: Activity,
    to: "/runs",
    search: { unknown: "value" },
  } as const;

  return (
    <>
      <Link to="/" />
      <Link to="/runs/$traceId" params={{ traceId: "trace-id" }} />
      <Link to="/runs" search={{ runId: "run-id" }} />
      {/* @ts-expect-error Unknown route paths are rejected. */}
      <Link to="/this-route-does-not-exist" />
      {/* @ts-expect-error Dynamic route params are required. */}
      <Link to="/runs/$traceId" />
      {/* @ts-expect-error Dynamic route params must use the registered key. */}
      <Link to="/runs/$traceId" params={{ traceID: "trace-id" }} />
      {/* @ts-expect-error Dynamic route params must have the registered value type. */}
      <Link to="/runs/$traceId" params={{ traceId: 123 }} />
      {/* @ts-expect-error Search keys are checked against the destination route. */}
      <Link to="/runs" search={{ unknown: "value" }} />

      <RailRow label="Runs" icon={Activity} to="/runs" />
      <RailRow
        label="Trace"
        icon={Activity}
        to="/runs/$traceId"
        params={{ traceId: "trace-id" }}
      />
      <RailRow
        label="Filtered runs"
        icon={Activity}
        to="/runs"
        search={{ runId: "run-id" }}
      />
      {/* @ts-expect-error Rail rows reject unknown routes. */}
      <RailRow {...unknownRailProps} />
      {/* @ts-expect-error Rail rows require dynamic route params. */}
      <RailRow {...missingParamsRailProps} />
      {/* @ts-expect-error Dynamic route params must use the registered key. */}
      <RailRow {...wrongParamKeyRailProps} />
      {/* @ts-expect-error Dynamic route params must have the registered value type. */}
      <RailRow {...wrongParamTypeRailProps} />
      {/* @ts-expect-error Rail rows do not allow activeProps overrides. */}
      <RailRow {...activePropsRailProps} />
      {/* @ts-expect-error Rail row search keys follow the route schema. */}
      <RailRow {...invalidSearchRailProps} />
    </>
  );
}

void checkSharedNavigationTypes;
