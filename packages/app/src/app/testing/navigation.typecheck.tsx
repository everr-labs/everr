import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { RailRow } from "#app/components/rail/rail-row.tsx";

function checkSelfHostedNavigationTypes() {
  return (
    <>
      <Link to="/setup" />
      <RailRow label="Setup" icon={Activity} to="/setup" />
      {/* @ts-expect-error The self-hosted route tree does not include Cloud billing. */}
      <Link to="/billing" />
      {/* @ts-expect-error The self-hosted route tree does not include Cloud billing. */}
      <RailRow label="Billing" icon={Activity} to="/billing" />
    </>
  );
}

void checkSelfHostedNavigationTypes;
