export function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-75 items-center justify-center text-muted-foreground text-sm">
      {message}
    </div>
  );
}

export function formatChartDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
