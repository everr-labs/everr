import { Spinner } from "@everr/ui/components/spinner";

export function RoutePending() {
  return (
    <div className="flex items-center justify-center h-dvh font-heading text-lg">
      <Spinner className="size-5 text-primary" />
    </div>
  );
}
