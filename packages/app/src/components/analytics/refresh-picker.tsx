import { RefreshPicker as BaseRefreshPicker } from "@everr/ui/components/refresh-picker";
import { useIsFetching } from "@tanstack/react-query";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";

export function RefreshPicker() {
  const { refreshInterval, setRefreshInterval, refreshNow } = useAutoRefresh();
  const isFetching = useIsFetching();

  return (
    <BaseRefreshPicker
      value={refreshInterval}
      onChange={setRefreshInterval}
      onRefresh={refreshNow}
      isFetching={isFetching > 0}
    />
  );
}
